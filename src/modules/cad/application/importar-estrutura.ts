import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { lerPlanilhaSegura } from '@/modules/ger/servidor';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma } from '@/shared/db';
import { falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { planejarCarga } from '../domain/carga';
import { COLUNAS_PLANO_CONTAS, validarPlanoContas, type ErroLinha } from '../domain/plano-contas';
import { comoNova, lerContasAtuais } from '../infrastructure/aplicar-carga';
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
