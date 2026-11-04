import 'server-only';
import type { PrismaClient } from '@/generated/prisma/client';
import { listarAnosExercicio, resumirCadastrosParaConferencia } from '@/modules/cad';
import { exportarCsv, exportarXlsx } from '@/modules/ger/servidor';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma } from '@/shared/db';
import { falha, ok, type Resultado } from '@/shared/kernel';
import { linhasConferencia, planilhaConferencia, type LinhaConferencia } from './linhas-conferencia';

// Relatório de conferência da carga (plano do P7, Task 2; US-115). Tela e exportação leem o mesmo
// resumo, numa transação em REPEATABLE READ (as contagens do mesmo instante). A soma dos
// salários fica com o cad: só com cad.salarios:consultar, e a consulta vai para o Histórico (R24).

type Deps = { cliente?: PrismaClient };

const anoValido = (ano: number | null): ano is number => ano !== null && Number.isInteger(ano) && ano >= 2000 && ano <= 2099;

export type TelaConferencia = { anos: readonly number[]; ano: number | null; linhas: readonly LinhaConferencia[] };

export async function obterConferenciaCarga(ctx: ContextoRequisicao, anoPedido: number | null, deps: Deps = {}): Promise<TelaConferencia> {
  exigir(ctx, 'rel.conferencia_carga', 'consultar');
  const cliente = deps.cliente ?? prisma;
  return cliente.$transaction(
    async (tx) => {
      const anos = await listarAnosExercicio(tx);
      const ano = anoValido(anoPedido) ? anoPedido : (anos[0] ?? null);
      const resumo = await resumirCadastrosParaConferencia(ctx, tx, ano ?? 0);
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
  const planilha = await cliente.$transaction(
    async (tx) => {
      const resumo = await resumirCadastrosParaConferencia(ctx, tx, ano);
      const p = planilhaConferencia(resumo, ano);
      const comSoma = resumo.cargos.somaSalarioReal.situacao === 'calculada';
      await auditar(tx, {
        contexto: { usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip, unidadeId: null },
        funcionalidade: 'rel.conferencia_carga',
        tipo: 'EXPORTACAO',
        registroId: String(ano),
        descricao: `Conferência da carga de ${ano} exportada em ${formato.toUpperCase()}${comSoma ? ', com a soma dos salários' : ''}`,
      });
      return p;
    },
    { isolationLevel: 'RepeatableRead' },
  );
  const r = formato === 'xlsx' ? await exportarXlsx([planilha]) : exportarCsv(planilha);
  if (!r.ok) return falha(r.erros);
  return ok({ nome: `conferencia-carga-${ano}.${formato}`, tipo: TIPOS[formato], bytes: r.valor });
}
