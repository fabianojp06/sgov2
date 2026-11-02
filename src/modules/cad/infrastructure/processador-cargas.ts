import { z } from 'zod';
import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { lerAmbiente } from '@/modules/ger/servidor';
import type { ContextoAuditoria } from '@/shared/audit';
import { sanearDescricao } from '../application/saneamento';
import { validarCentrosCusto, type LinhaCentroCustoValidada } from '../domain/centros-custo';
import { validarPlanoContas, type ErroLinha, type LinhaPlanoValidada } from '../domain/plano-contas';
import { aplicarCarga, aplicarCargaCentrosCusto, ErroCargaLinhas } from './aplicar-carga';
import { centroParaLinhaLida, paraLinhaLida } from './staging';

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

const linhaStagingCentroCusto = z
  .object({
    linha: z.number().int().positive(),
    classificacao: z.string(),
    codigoReduzido: z.string(),
    descricao: z.string(),
    descricaoOriginal: z.string().nullable(),
    nivel: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    tipo: z.enum(['SINTETICO', 'ANALITICO']),
    classificacaoPai: z.string().nullable(),
    deGestao: z.boolean(),
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

type Lote = {
  id: string;
  tipo: string;
  grupo: string;
  linhas: number;
  contexto_auditoria: unknown;
  provisoria: boolean;
  aprovacao_data: Date | null;
  aprovacao_documento: string | null;
};

// Diagnóstico para o log: classe, código do Prisma/Postgres e a mensagem do banco (cita só
// estrutura, como a classificação; nunca o conteúdo de uma linha do staging).
function diagnostico(e: unknown): Record<string, unknown> {
  if (!(e instanceof Error)) return { erro: 'desconhecido' };
  const d: Record<string, unknown> = { erro: e.name };
  if (e instanceof Prisma.PrismaClientKnownRequestError) Object.assign(d, { code: e.code, meta: e.meta });
  if (e instanceof Prisma.PrismaClientKnownRequestError || e instanceof Prisma.PrismaClientUnknownRequestError) {
    d.mensagem = e.message.split('\n').slice(-1)[0]?.slice(0, 300);
  } else if (!(e instanceof ErroStaging) && !(e instanceof ErroCargaLinhas) && e.name !== 'ZodError') {
    d.mensagem = e.message.slice(0, 300);
  }
  return d;
}

// Mensagem gravada no lote: nunca com valores (R6). O detalhe por linha vai em `erros`.
function mensagemDeFalha(e: unknown): { erro: string; erros: readonly ErroLinha[]; codigo: string } {
  if (e instanceof ErroCargaLinhas) return { erro: 'A carga diverge do plano de contas atual.', erros: e.erros, codigo: e.codigo };
  if (e instanceof ErroStaging) return { erro: 'As linhas da carga não passaram na revalidação.', erros: e.erros, codigo: 'cad.staging_invalido' };
  if (e instanceof Prisma.PrismaClientKnownRequestError || e instanceof Prisma.PrismaClientUnknownRequestError) {
    return { erro: 'A carga deixaria a estrutura inconsistente.', erros: [], codigo: 'cad.carga_inconsistente' };
  }
  return { erro: 'Falha ao aplicar a carga.', erros: [], codigo: 'cad.carga_falhou' };
}

const CAMPOS_LINHA = ['linha', 'classificacao', 'codigoReduzido', 'descricao', 'nivel', 'tipo', 'classificacaoPai'] as const;

type Revalidado<T> = { linhas: T[]; avisos: readonly ErroLinha[] };

function revalidar(linhas: readonly { numero: number; dados: unknown }[], esperadas: number): Revalidado<LinhaPlanoValidada> {
  // O sgo_app só insere no staging: linha a mais ou a menos que o lote declarou não é desta carga.
  if (linhas.length !== esperadas) throw new ErroStaging([{ linha: 0, mensagem: 'O staging não tem o número de linhas do lote.' }]);
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
  // O staging tem de ser exatamente a saída do domínio (descrição saneada etc.); grava-se a saída.
  const porLinha = new Map(r.contas.map((c) => [c.linha, c]));
  const divergentes = validas.filter((v) => CAMPOS_LINHA.some((k) => porLinha.get(v.linha)?.[k] !== v[k]));
  if (divergentes.length > 0) throw new ErroStaging(divergentes.map((d) => ({ linha: d.linha, mensagem: 'Linha adulterada no staging.' })));
  return { linhas: [...r.contas], avisos: r.avisos };
}

const CAMPOS_CC = ['linha', 'classificacao', 'codigoReduzido', 'descricao', 'descricaoOriginal', 'nivel', 'tipo', 'classificacaoPai', 'deGestao'] as const;

function revalidarCentrosCusto(linhas: readonly { numero: number; dados: unknown }[], esperadas: number): Revalidado<LinhaCentroCustoValidada> {
  if (linhas.length !== esperadas) throw new ErroStaging([{ linha: 0, mensagem: 'O staging não tem o número de linhas do lote.' }]);
  const erros: ErroLinha[] = [];
  const validas: LinhaCentroCustoValidada[] = [];
  for (const l of linhas) {
    const r = linhaStagingCentroCusto.safeParse(l.dados);
    if (!r.success || r.data.linha !== l.numero) erros.push({ linha: l.numero, mensagem: 'Linha adulterada no staging.' });
    else validas.push(r.data);
  }
  if (erros.length > 0) throw new ErroStaging(erros);
  const r = validarCentrosCusto(validas.map(centroParaLinhaLida), sanearDescricao);
  if (!r.ok) throw new ErroStaging(r.erros);
  const porLinha = new Map(r.centros.map((c) => [c.linha, c]));
  const divergentes = validas.filter((v) => CAMPOS_CC.some((k) => porLinha.get(v.linha)?.[k] !== v[k]));
  if (divergentes.length > 0) throw new ErroStaging(divergentes.map((d) => ({ linha: d.linha, mensagem: 'Linha adulterada no staging.' })));
  return { linhas: [...r.centros], avisos: r.avisos };
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
  let parando = false;

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
          const [lote] = await tx.$queryRaw<Lote[]>`SELECT "id", "tipo"::text AS tipo, "grupo", "linhas", "contexto_auditoria", "provisoria", "aprovacao_data", "aprovacao_documento"
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
          const lido = contextoLote.parse(lote.contexto_auditoria);
          const contexto: ContextoAuditoria = { ...lido, unidadeId: lido.unidadeId ?? null };
          const staging = await tx.cargaEstruturaLinha.findMany({ where: { cargaId: lote.id }, orderBy: { numero: 'asc' } });
          let r: Awaited<ReturnType<typeof aplicarCarga>>;
          // Os avisos da validação (saneamento, R3 da minuta) vão para o lote junto com os da R5.
          let avisosValidacao: readonly ErroLinha[];
          if (lote.tipo === 'PLANO_CONTAS') {
            const v = revalidar(staging, lote.linhas);
            avisosValidacao = v.avisos;
            r = await aplicarCarga(tx, contexto, { id: lote.id, tipo: 'PLANO_CONTAS' }, v.linhas);
          } else if (lote.tipo === 'CENTROS_CUSTO') {
            // R16 (S-N3): sem a DIREX (gravada por fora, inclusive), o lote é provisório; em produção, recusado.
            const semAprovacao = lote.aprovacao_data === null || (lote.aprovacao_documento ?? '').trim().length < 3;
            const provisoria = lote.provisoria || semAprovacao;
            if (lerAmbiente() === 'producao' && provisoria) {
              throw new ErroStaging([{ linha: 0, mensagem: 'Em produção, a carga de centros de custo exige a aprovação da DIREX.' }]);
            }
            const v = revalidarCentrosCusto(staging, lote.linhas);
            avisosValidacao = v.avisos;
            r = await aplicarCargaCentrosCusto(tx, contexto, { id: lote.id, provisoria }, v.linhas);
          } else {
            throw new Error(`tipo de carga sem processador: ${lote.tipo}`);
          }
          await tx.cargaEstrutura.update({
            where: { id: lote.id },
            data: {
              situacao: 'CONCLUIDA',
              incluidas: r.incluidas,
              alteradas: r.alteradas,
              inativadas: r.inativadas,
              inalteradas: r.inalteradas,
              avisos: [...avisosValidacao, ...r.avisos] as Prisma.InputJsonValue,
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
      console.error('[CARGA_FALHOU]', { cargaId: loteId, codigo: f.codigo, ...diagnostico(e) });
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
    while (!parando && (await processarUm()));
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
          executarCiclo().catch((e: unknown) => console.error('[CARGA_CICLO_FALHOU]', diagnostico(e)));
        }, deps.intervaloMs ?? INTERVALO_MS);

  return {
    executarCiclo,
    async parar() {
      // O lote em andamento termina; os seguintes ficam PENDENTE para o próximo worker.
      parando = true;
      if (intervalo) clearInterval(intervalo);
      await emAndamento?.catch(() => undefined);
    },
  };
}
