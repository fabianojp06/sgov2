import 'server-only';
import type { PrismaClient } from '@/generated/prisma/client';
import { contarUsuariosPorPerfil } from '@/modules/adm/servidor';
import { listarAnosExercicio, resumirCadastrosParaConferencia } from '@/modules/cad';
import { criarIdentificacao, TIPOS_ARQUIVO, type FormatoArquivo } from '@/modules/ger';
import { gerarArquivo } from '@/modules/ger/servidor';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma } from '@/shared/db';
import { falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
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
      return { anos, ano, linhas: linhasConferencia(resumo, await contarUsuariosPorPerfil(tx)) };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}

export type FormatoExportacao = FormatoArquivo;
export type ArquivoExportado = { nome: string; tipo: string; bytes: Uint8Array };

class FalhaGeracao extends Error {
  constructor(readonly erros: ErroCampo[]) {
    super('geração do arquivo');
  }
}

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
  // O arquivo é gerado antes do Histórico (EP083, UC0.05: o arquivo, depois o registro; RN0232: só a
  // extração bem-sucedida). Se a geração falhar, a transação é desfeita, inclusive a consulta de
  // salário: nenhum registro fica para uma exportação que não aconteceu.
  try {
    const bytes = await cliente.$transaction(
      async (tx) => {
        const resumo = await resumirCadastrosParaConferencia(ctx, tx, ano);
        // US-024: filtros, operador e rastreio no cabeçalho do arquivo; o mesmo rastreio no Histórico.
        const filtros = [{ rotulo: 'Exercício', valor: String(ano) }];
        const identificacao = criarIdentificacao({ titulo: `Conferência da carga ${ano}`, filtros, operador: ctx.usuarioRotulo });
        const p = planilhaConferencia(resumo, await contarUsuariosPorPerfil(tx), ano, identificacao);
        const comSoma = resumo.cargos.somaSalarioReal.situacao === 'calculada';
        const r = await gerarArquivo(formato, [p]);
        if (!r.ok) throw new FalhaGeracao([...r.erros]);
        await auditar(tx, {
          contexto: { usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip, unidadeId: null },
          funcionalidade: 'rel.conferencia_carga',
          tipo: 'EXPORTACAO',
          registroId: String(ano),
          descricao: `Conferência da carga de ${ano} exportada em ${formato.toUpperCase()}${comSoma ? ', com a soma dos salários' : ''} (rastreio ${identificacao.rastreio})`,
          // RN0011 do Catálogo: quantidade de registros e filtros; RN_WATERMARK: o rastreio do arquivo.
          depois: { formato, registros: p.linhas.length, filtros, rastreio: identificacao.rastreio },
        });
        return r.valor;
      },
      { isolationLevel: 'RepeatableRead' },
    );
    return ok({ nome: `conferencia-carga-${ano}.${formato}`, tipo: TIPOS_ARQUIVO[formato], bytes });
  } catch (e) {
    if (e instanceof FalhaGeracao) return falha(e.erros);
    throw e;
  }
}
