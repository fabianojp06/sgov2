import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { lerAmbiente, lerPlanilhaSegura } from '@/modules/ger/servidor';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma } from '@/shared/db';
import { falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { planejarCarga } from '../domain/carga';
import { COLUNAS_CENTROS_CUSTO, validarCentrosCusto } from '../domain/centros-custo';
import { COLUNAS_PLANO_CONTAS, validarPlanoContas, type ErroLinha } from '../domain/plano-contas';
import { comoNova, comoNovoCentroCusto, lerCentrosCustoAtuais, lerContasAtuais } from '../infrastructure/aplicar-carga';
import { sanearDescricao } from './saneamento';

// Importação de estrutura no app (plano do P4, R6; US-043): só o sgo_app. Lê e valida o arquivo
// inteiro, planeja contra o banco (E-N2) e grava o lote PENDENTE com as linhas no staging; o
// merge é do worker (sgo_sync). Qualquer erro reprova o arquivo inteiro (Review Focus 3).

export type TipoCarga = 'PLANO_CONTAS' | 'CENTROS_CUSTO' | 'CARGOS' | 'CARGOS_RECIFRA';
export type ArquivoCarga = { nome: string; conteudo: Uint8Array };
export type EstadoCarga = {
  cargaId: string;
  tipo: TipoCarga;
  situacao: 'PENDENTE' | 'PROCESSANDO' | 'CONCLUIDA' | 'FALHOU';
  linhas: number;
  incluidas: number | null;
  alteradas: number | null;
  inativadas: number | null;
  inalteradas: number | null;
  avisos: readonly ErroLinha[];
  erros: readonly ErroLinha[];
  erro: string | null;
};

// M-n1: a permissão vem do tipo do lote.
const FUNCIONALIDADE_POR_TIPO: Record<TipoCarga, string> = {
  PLANO_CONTAS: 'cad.plano_contas',
  CENTROS_CUSTO: 'cad.centros_custo',
  CARGOS: 'cad.cargos',
  CARGOS_RECIFRA: 'cad.cargos',
};

const EM_ANDAMENTO = 'Já existe uma carga do plano de contas em andamento. Tente de novo em instantes.';

const porLinha = (erros: readonly ErroLinha[]): ErroCampo[] =>
  erros.map((e) => ({ campo: e.coluna ? `linhas.${e.linha}.${e.coluna}` : `linhas.${e.linha}`, mensagem: e.mensagem }));

// Violação do índice único parcial de lote em andamento (pelo SQL explícito, vem como erro bruto).
function emAndamento(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return e.message.includes('carga_estrutura_grupo_andamento_key') || JSON.stringify(e.meta ?? {}).includes('carga_estrutura_grupo_andamento_key');
}

/**
 * Pede a carga do plano de contas (GFIN: cad.plano_contas:executar). Devolve o id do lote para a
 * tela acompanhar com consultarCarga. Erros de arquivo em `arquivo`; erros por linha em
 * `linhas.<n>.<coluna>`; carga do mesmo grupo em andamento, erro geral.
 */
export async function solicitarCargaPlanoContas(
  ctx: ContextoRequisicao,
  arquivo: ArquivoCarga,
  deps: { cliente?: PrismaClient } = {},
): Promise<Resultado<{ cargaId: string; avisos: readonly ErroLinha[] }>> {
  exigir(ctx, 'cad.plano_contas', 'executar');
  const cliente = deps.cliente ?? prisma;

  const lida = await lerPlanilhaSegura(arquivo, { aba: 'Plano de Contas', colunas: COLUNAS_PLANO_CONTAS, linhaCabecalhoMax: 1 });
  if (!lida.ok) return lida;
  if (lida.valor.errosCelula.length > 0) return falha(porLinha(lida.valor.errosCelula));

  const validado = validarPlanoContas(lida.valor.linhas, sanearDescricao);
  if (!validado.ok) return falha(porLinha(validado.erros));

  // E-N2: os erros da R5 que dependem do banco voltam por linha, antes de gravar.
  const plano = planejarCarga(await lerContasAtuais(cliente), validado.contas.map(comoNova));
  if (plano.erros.length > 0) return falha(porLinha(plano.erros));

  const cargaId = randomUUID();
  const contexto = { usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip, unidadeId: ctx.unidadeId ?? null };
  try {
    await cliente.$transaction(async (tx) => {
      // SQL explícito, só nas colunas de entrada (S-N3): situação, grupo e resultado vêm do banco.
      await tx.$executeRaw`INSERT INTO "carga_estrutura" ("id", "tipo", "arquivo_nome", "arquivo_sha256", "linhas", "contexto_auditoria")
        VALUES (${cargaId}::uuid, 'PLANO_CONTAS', ${lida.valor.nomeArquivo}, ${createHash('sha256').update(arquivo.conteudo).digest('hex')},
          ${validado.contas.length}, ${JSON.stringify(contexto)}::jsonb)`;
      // Sem RETURNING: o sgo_app não lê o staging (M-n5).
      await tx.cargaEstruturaLinha.createMany({
        data: validado.contas.map((c) => ({ cargaId, numero: c.linha, dados: c as unknown as Prisma.InputJsonValue })),
      });
      await auditar(tx, {
        contexto,
        funcionalidade: 'cad.plano_contas',
        tipo: 'INSERCAO',
        registroId: cargaId,
        descricao: 'Importação do plano de contas solicitada',
        depois: { arquivo: lida.valor.nomeArquivo, linhas: validado.contas.length, avisos: validado.avisos.length },
      });
    });
  } catch (e) {
    if (emAndamento(e)) return falha([{ campo: 'arquivo', mensagem: EM_ANDAMENTO }]);
    throw e;
  }
  // Os avisos (descrição saneada) só existem aqui: o staging já vai saneado.
  return ok({ cargaId, avisos: validado.avisos });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Estado do lote, ou null se não existe ou se o usuário não tem a permissão do tipo dele (M-n1). */
export async function consultarCarga(ctx: ContextoRequisicao, cargaId: string, deps: { cliente?: PrismaClient } = {}): Promise<EstadoCarga | null> {
  if (!UUID.test(cargaId)) return null;
  const c = await (deps.cliente ?? prisma).cargaEstrutura.findUnique({ where: { id: cargaId } });
  if (!c || !ctx.permissoes.has(`${FUNCIONALIDADE_POR_TIPO[c.tipo]}:executar`)) return null;
  return {
    cargaId: c.id,
    tipo: c.tipo,
    situacao: c.situacao,
    linhas: c.linhas,
    incluidas: c.incluidas,
    alteradas: c.alteradas,
    inativadas: c.inativadas,
    inalteradas: c.inalteradas,
    avisos: (c.avisos as ErroLinha[] | null) ?? [],
    erros: (c.erros as ErroLinha[] | null) ?? [],
    erro: c.erro,
  };
}

/** Aprovação da DIREX gravada no lote e no Histórico (R16, P8). */
export type AprovacaoDirex = { data: string; documento: string };

const EM_ANDAMENTO_CC = 'Já existe uma carga de centros de custo em andamento. Tente de novo em instantes.';

function validarAprovacao(a: AprovacaoDirex, hoje: Date): ErroCampo[] {
  const erros: ErroCampo[] = [];
  const data = /^\d{4}-\d{2}-\d{2}$/.test(a.data) ? new Date(`${a.data}T00:00:00Z`) : null;
  if (!data || Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== a.data) {
    erros.push({ campo: 'aprovacao.data', mensagem: 'Informe a data da aprovação (AAAA-MM-DD).' });
  } else if (a.data < '2000-01-01') {
    erros.push({ campo: 'aprovacao.data', mensagem: 'A data da aprovação deve ser de 2000 em diante.' });
  } else if (a.data > new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(hoje)) {
    erros.push({ campo: 'aprovacao.data', mensagem: 'A data da aprovação não pode ser futura.' });
  }
  const doc = a.documento.trim();
  if (doc.length < 3 || doc.length > 120 || /[\p{Cc}\p{Cf}]/u.test(doc)) {
    erros.push({ campo: 'aprovacao.documento', mensagem: 'Informe a referência do documento de aprovação (3 a 120 caracteres).' });
  }
  return erros;
}

/**
 * Carga provisória (sem a DIREX) só com CC_CARGA_PROVISORIA=1, e nunca em produção (R16, M1): lá a
 * variável é ignorada, com [CC_CARGA_PROVISORIA_IGNORADA]. Variável ausente = exige aprovação.
 */
export function cargaProvisoriaPermitida(env: NodeJS.ProcessEnv = process.env, opcoes: { registrar?: boolean } = {}): boolean {
  if (env.CC_CARGA_PROVISORIA !== '1') return false;
  if (lerAmbiente(env) === 'producao') {
    // A tela só pergunta para mostrar o aviso (registrar: false); o log fica para a carga pedida.
    if (opcoes.registrar !== false) console.warn('[CC_CARGA_PROVISORIA_IGNORADA] CC_CARGA_PROVISORIA não vale em produção');
    return false;
  }
  return true;
}

/**
 * Pede a carga dos centros de custo (cad.centros_custo:executar). Com a aprovação da DIREX, a carga
 * entra com provisorio = false; sem ela, só se a carga provisória for permitida, e então todos os CCs
 * da carga ficam provisórios (GAP-CC-001).
 */
export async function solicitarCargaCentrosCusto(
  ctx: ContextoRequisicao,
  arquivo: ArquivoCarga,
  aprovacao: AprovacaoDirex | null,
  deps: { cliente?: PrismaClient; cargaProvisoriaPermitida?: boolean; agora?: () => Date } = {},
): Promise<Resultado<{ cargaId: string; avisos: readonly ErroLinha[] }>> {
  exigir(ctx, 'cad.centros_custo', 'executar');
  const cliente = deps.cliente ?? prisma;
  if (aprovacao === null) {
    if (!(deps.cargaProvisoriaPermitida ?? cargaProvisoriaPermitida())) {
      return falha([
        {
          campo: 'aprovacao',
          mensagem:
            'Informe a data e o documento de aprovação da DIREX. A carga de centros de custo em produção só acontece depois dessa aprovação (GAP-CC-001).',
        },
      ]);
    }
  } else {
    const erros = validarAprovacao(aprovacao, (deps.agora ?? (() => new Date()))());
    if (erros.length > 0) return falha(erros);
  }

  const lida = await lerPlanilhaSegura(arquivo, { colunas: COLUNAS_CENTROS_CUSTO, linhaCabecalhoMax: 10, colunasTexto: ['Código reduzido'] });
  if (!lida.ok) return lida;
  if (lida.valor.errosCelula.length > 0) return falha(porLinha(lida.valor.errosCelula));
  const validado = validarCentrosCusto(lida.valor.linhas, sanearDescricao);
  if (!validado.ok) return falha(porLinha(validado.erros));
  const plano = planejarCarga(await lerCentrosCustoAtuais(cliente), validado.centros.map(comoNovoCentroCusto), { colunaReduzido: 'Código reduzido' });
  if (plano.erros.length > 0) return falha(porLinha(plano.erros));

  const cargaId = randomUUID();
  const contexto = { usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip, unidadeId: ctx.unidadeId ?? null };
  const provisoria = aprovacao === null;
  try {
    await cliente.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO "carga_estrutura" ("id", "tipo", "arquivo_nome", "arquivo_sha256", "linhas", "provisoria",
          "aprovacao_data", "aprovacao_documento", "contexto_auditoria")
        VALUES (${cargaId}::uuid, 'CENTROS_CUSTO', ${lida.valor.nomeArquivo}, ${createHash('sha256').update(arquivo.conteudo).digest('hex')},
          ${validado.centros.length}, ${provisoria}, ${aprovacao?.data ?? null}::date, ${aprovacao?.documento.trim() ?? null},
          ${JSON.stringify(contexto)}::jsonb)`;
      await tx.cargaEstruturaLinha.createMany({
        data: validado.centros.map((c) => ({ cargaId, numero: c.linha, dados: c as unknown as Prisma.InputJsonValue })),
      });
      await auditar(tx, {
        contexto,
        funcionalidade: 'cad.centros_custo',
        tipo: 'INSERCAO',
        registroId: cargaId,
        descricao: provisoria ? 'Importação provisória dos centros de custo solicitada (sem a DIREX)' : 'Importação dos centros de custo solicitada',
        depois: {
          arquivo: lida.valor.nomeArquivo,
          linhas: validado.centros.length,
          provisoria,
          aprovacao: aprovacao ? { data: aprovacao.data, documento: aprovacao.documento.trim() } : null,
          avisos: validado.avisos.length,
        },
      });
    });
  } catch (e) {
    if (emAndamento(e)) return falha([{ campo: 'arquivo', mensagem: EM_ANDAMENTO_CC }]);
    throw e;
  }
  return ok({ cargaId, avisos: validado.avisos });
}
