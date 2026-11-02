import { z } from 'zod';
import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import type { ContextoAuditoria } from '@/shared/audit';
import { sanearDescricao } from '../application/saneamento';
import { validarPlanoContas, type ErroLinha, type LinhaPlanoValidada } from '../domain/plano-contas';
import { aplicarCarga, ErroCargaLinhas } from './aplicar-carga';
import { paraLinhaLida } from './staging';

// Casca do merge no worker (plano do P4, R6): o único processo com SYNC_DATABASE_URL. A cada ciclo:
// confere o papel (S-N1), limpa lotes presos ou vencidos (S-N2, E-N1) e processa o lote pendente
// mais antigo numa transação única. Falha grava FALHOU numa transação nova e nunca é reprocessada.
// R22/E-N4: sem @/shared/authz nem next/.

const LIMITE_PROCESSANDO_MS = 15 * 60 * 1000;
const VALIDADE_PENDENTE_MS = 24 * 60 * 60 * 1000;
const INTERVALO_MS = 5000;

const TRAVA_POR_GRUPO: Record<string, string> = {
  PLANO_CONTAS: 'sync-plano',
  CENTROS_CUSTO: 'sync-cc',
  CARGOS: 'sync-cargos',
};

const linhaStaging = z
  .object({
    linha: z.number().int().positive(),
    classificacao: z.string(),
    codigoReduzido: z.string().nullable(),
    descricao: z.string(),
    nivel: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    tipo: z.enum(['SINTETICA', 'ANALITICA']),
    classificacaoPai: z.string().nullable(),
  })
  .strict();

const contextoLote = z.object({
  usuarioId: z.uuid().nullable(),
  usuarioRotulo: z.string().min(1),
  sessaoUid: z.string().nullable(),
  ip: z.string().nullable(),
  unidadeId: z.uuid().nullable().optional(),
});

/** Falha de revalidação do staging, com erros por linha (S-N3). */
class ErroStaging extends Error {
  constructor(readonly erros: readonly ErroLinha[]) {
    super('staging inválido');
  }
}

type Lote = { id: string; tipo: string; grupo: string; contexto_auditoria: unknown };

// Mensagem gravada no lote: nunca com valores (R6). O detalhe por linha vai em `erros`.
function mensagemDeFalha(e: unknown): { erro: string; erros: readonly ErroLinha[]; codigo: string } {
  if (e instanceof ErroCargaLinhas) return { erro: 'A carga diverge do plano de contas atual.', erros: e.erros, codigo: e.codigo };
  if (e instanceof ErroStaging) return { erro: 'As linhas da carga não passaram na revalidação.', erros: e.erros, codigo: 'cad.staging_invalido' };
  if (e instanceof Prisma.PrismaClientKnownRequestError || e instanceof Prisma.PrismaClientUnknownRequestError) {
    return { erro: 'A carga deixaria a estrutura inconsistente.', erros: [], codigo: 'cad.carga_inconsistente' };
  }
  return { erro: 'Falha ao aplicar a carga.', erros: [], codigo: 'cad.carga_falhou' };
}

function revalidar(linhas: readonly { numero: number; dados: unknown }[]): LinhaPlanoValidada[] {
  const erros: ErroLinha[] = [];
  const validas: LinhaPlanoValidada[] = [];
  for (const l of linhas) {
    const r = linhaStaging.safeParse(l.dados);
    if (!r.success || r.data.linha !== l.numero) erros.push({ linha: l.numero, mensagem: 'Linha adulterada no staging.' });
    else validas.push(r.data);
  }
  if (erros.length > 0) throw new ErroStaging(erros);
  // O mesmo domínio do app, de novo, sobre o que está no staging (S-N3).
  const r = validarPlanoContas(validas.map(paraLinhaLida), sanearDescricao);
  if (!r.ok) throw new ErroStaging(r.erros);
  const porLinha = new Map(r.contas.map((c) => [c.linha, c]));
  const divergentes = validas.filter((v) => JSON.stringify(porLinha.get(v.linha)) !== JSON.stringify(v));
  if (divergentes.length > 0) throw new ErroStaging(divergentes.map((d) => ({ linha: d.linha, mensagem: 'Linha adulterada no staging.' })));
  return validas;
}

export function iniciarProcessadorCargas(deps: {
  clienteSync: PrismaClient | null;
  agora?: () => Date;
  intervaloMs?: number;
  limiteProcessandoMs?: number;
  validadePendenteMs?: number;
  /** Sem intervalo, só executarCiclo() (testes). */
  automatico?: boolean;
}): { executarCiclo(): Promise<void>; parar(): Promise<void> } {
  const agora = deps.agora ?? (() => new Date());
  const limiteProcessando = deps.limiteProcessandoMs ?? LIMITE_PROCESSANDO_MS;
  const validadePendente = deps.validadePendenteMs ?? VALIDADE_PENDENTE_MS;
  const cliente = deps.clienteSync;
  let avisouSemSync = false;
  let emAndamento: Promise<void> | null = null;

  async function falhar(id: string, erro: string, erros: readonly ErroLinha[]): Promise<void> {
    await cliente!.$transaction(async (tx) => {
      await tx.cargaEstrutura.update({
        where: { id },
        data: { situacao: 'FALHOU', erro, erros: erros as Prisma.InputJsonValue, concluidoEm: agora() },
      });
      await tx.cargaEstruturaLinha.deleteMany({ where: { cargaId: id } });
    });
  }

  async function limpar(): Promise<void> {
    const presos = await cliente!.cargaEstrutura.findMany({
      where: { situacao: 'PROCESSANDO', processandoDesde: { lt: new Date(agora().getTime() - limiteProcessando) } },
      select: { id: true },
    });
    for (const { id } of presos) await falhar(id, 'processamento interrompido', []);
    const vencidos = await cliente!.cargaEstrutura.findMany({
      where: { situacao: 'PENDENTE', criadoEm: { lt: new Date(agora().getTime() - validadePendente) } },
      select: { id: true },
    });
    for (const { id } of vencidos) await falhar(id, 'expirada', []);
  }

  async function processarUm(): Promise<boolean> {
    let loteId: string | null = null;
    try {
      const processou = await cliente!.$transaction(
        async (tx) => {
          const [lote] = await tx.$queryRaw<Lote[]>`SELECT "id", "tipo"::text AS tipo, "grupo", "contexto_auditoria"
            FROM "carga_estrutura" WHERE "situacao" = 'PENDENTE' ORDER BY "criado_em" LIMIT 1 FOR UPDATE SKIP LOCKED`;
          if (!lote) return false;
          loteId = lote.id;
          const trava = TRAVA_POR_GRUPO[lote.grupo];
          const [trancado] = await tx.$queryRaw<{ obtida: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${trava ?? `sync-${lote.grupo}`})) AS obtida`;
          // Outro processo está mexendo no mesmo grupo: o lote fica PENDENTE para o próximo ciclo.
          if (!trancado?.obtida) {
            loteId = null;
            return false;
          }
          await tx.cargaEstrutura.update({ where: { id: lote.id }, data: { situacao: 'PROCESSANDO', processandoDesde: agora() } });
          if (lote.tipo !== 'PLANO_CONTAS') throw new Error(`tipo de carga sem processador: ${lote.tipo}`);
          const lido = contextoLote.parse(lote.contexto_auditoria);
          const contexto: ContextoAuditoria = { ...lido, unidadeId: lido.unidadeId ?? null };
          const staging = await tx.cargaEstruturaLinha.findMany({ where: { cargaId: lote.id }, orderBy: { numero: 'asc' } });
          const linhas = revalidar(staging);
          const r = await aplicarCarga(tx, contexto, { id: lote.id, tipo: 'PLANO_CONTAS' }, linhas);
          await tx.cargaEstrutura.update({
            where: { id: lote.id },
            data: {
              situacao: 'CONCLUIDA',
              incluidas: r.incluidas,
              alteradas: r.alteradas,
              inativadas: r.inativadas,
              inalteradas: r.inalteradas,
              avisos: r.avisos as Prisma.InputJsonValue,
              erros: [],
              concluidoEm: agora(),
            },
          });
          await tx.cargaEstruturaLinha.deleteMany({ where: { cargaId: lote.id } });
          return true;
        },
        { timeout: 120_000, maxWait: 10_000 },
      );
      return processou;
    } catch (e) {
      if (loteId === null) throw e;
      const f = mensagemDeFalha(e);
      console.error('[CARGA_FALHOU]', { cargaId: loteId, codigo: f.codigo });
      await falhar(loteId, f.erro, f.erros);
      return true;
    }
  }

  async function ciclo(): Promise<void> {
    if (!cliente) {
      if (!avisouSemSync) console.warn('[CARGA_SEM_SYNC] sem SYNC_DATABASE_URL: as cargas ficam PENDENTE');
      avisouSemSync = true;
      return;
    }
    const [linha] = await cliente.$queryRaw<{ papel: string }[]>`SELECT current_user::text AS papel`;
    const papel = linha?.papel;
    if (papel !== 'sgo_sync') {
      console.error('[CARGA_PAPEL_INVALIDO]', { papel });
      return;
    }
    await limpar();
    // Processa os pendentes um por vez, cada um na sua transação.
    while (await processarUm());
  }

  function executarCiclo(): Promise<void> {
    emAndamento ??= ciclo().finally(() => {
      emAndamento = null;
    });
    return emAndamento;
  }

  const intervalo =
    deps.automatico === false
      ? null
      : setInterval(() => {
          executarCiclo().catch((e: unknown) => console.error('[CARGA_CICLO_FALHOU]', { erro: e instanceof Error ? e.name : 'desconhecido' }));
        }, deps.intervaloMs ?? INTERVALO_MS);

  return {
    executarCiclo,
    async parar() {
      if (intervalo) clearInterval(intervalo);
      await emAndamento?.catch(() => undefined);
    },
  };
}
