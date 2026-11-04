import 'server-only';
import type { PrismaClient } from '@/generated/prisma/client';
import { listarAnosExercicio, resumirCadastros, type CifraSalarios } from '@/modules/cad/servidor';
import { exportarCsv, exportarXlsx } from '@/modules/ger/servidor';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma, type TxCliente } from '@/shared/db';
import { falha, ok, type Resultado } from '@/shared/kernel';
import { linhasConferencia, planilhaConferencia, type LinhaConferencia } from './linhas-conferencia';

// Relatório de conferência da carga (plano do P7, Task 2; US-115). Tela e exportação leem o mesmo
// resumo, numa transação em REPEATABLE READ (as contagens do mesmo instante). A soma dos
// salários só é decifrada com cad.salarios:consultar (R24).

type Deps = { cliente?: PrismaClient; cifra?: CifraSalarios };

// Decifrar a soma dos salários é uma consulta de salário: vai para o Histórico, como no custo do cargo (R24).
async function auditarConsultaSalarios(tx: TxCliente, ctx: ContextoRequisicao, ano: number | null): Promise<void> {
  await auditar(tx, {
    contexto: { usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip, unidadeId: null },
    funcionalidade: 'cad.salarios',
    tipo: 'CONSULTA',
    registroId: `conferencia-carga-${ano ?? 'sem-ano'}`,
    descricao: 'Soma dos salários reais dos cargos ativos consultada na conferência da carga',
  });
}

const anoValido = (ano: number | null): ano is number => ano !== null && Number.isInteger(ano) && ano >= 2000 && ano <= 2099;

export type TelaConferencia = { anos: readonly number[]; ano: number | null; linhas: readonly LinhaConferencia[] };

export async function obterConferenciaCarga(ctx: ContextoRequisicao, anoPedido: number | null, deps: Deps = {}): Promise<TelaConferencia> {
  exigir(ctx, 'rel.conferencia_carga', 'consultar');
  const cliente = deps.cliente ?? prisma;
  return cliente.$transaction(
    async (tx) => {
      const anos = await listarAnosExercicio(tx);
      const ano = anoValido(anoPedido) ? anoPedido : (anos[0] ?? null);
      const salarios = ctx.permissoes.has('cad.salarios:consultar');
      const resumo = await resumirCadastros(tx, ano ?? 0, { salarios, ...(deps.cifra ? { cifra: deps.cifra } : {}) });
      if (salarios) await auditarConsultaSalarios(tx, ctx, ano);
      return { anos, ano, linhas: linhasConferencia(resumo) };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}

export type FormatoExportacao = 'xlsx' | 'csv';
export type ArquivoExportado = { nome: string; tipo: string; bytes: Uint8Array };

const TIPOS: Record<FormatoExportacao, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
};

/** Exporta a conferência do exercício e registra a exportação no Histórico (US-024, RN0011). */
export async function exportarConferenciaCarga(
  ctx: ContextoRequisicao,
  ano: number,
  formato: FormatoExportacao,
  deps: Deps = {},
): Promise<Resultado<ArquivoExportado>> {
  exigir(ctx, 'rel.conferencia_carga', 'exportar');
  if (!anoValido(ano)) return falha([{ campo: 'ano', mensagem: 'Exercício inválido.' }]);
  const cliente = deps.cliente ?? prisma;
  const salarios = ctx.permissoes.has('cad.salarios:consultar');
  const planilha = await cliente.$transaction(
    async (tx) => {
      const p = planilhaConferencia(await resumirCadastros(tx, ano, { salarios, ...(deps.cifra ? { cifra: deps.cifra } : {}) }), ano);
      if (salarios) await auditarConsultaSalarios(tx, ctx, ano);
      await auditar(tx, {
        contexto: { usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip, unidadeId: null },
        funcionalidade: 'rel.conferencia_carga',
        tipo: 'EXPORTACAO',
        registroId: String(ano),
        descricao: `Conferência da carga de ${ano} exportada em ${formato.toUpperCase()}${salarios ? ', com a soma dos salários' : ''}`,
      });
      return p;
    },
    { isolationLevel: 'RepeatableRead' },
  );
  const r = formato === 'xlsx' ? await exportarXlsx([planilha]) : exportarCsv(planilha);
  if (!r.ok) return falha(r.erros);
  return ok({ nome: `conferencia-carga-${ano}.${formato}`, tipo: TIPOS[formato], bytes: r.valor });
}
