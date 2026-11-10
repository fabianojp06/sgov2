import type { DefinicaoFiltro, FiltroExportacao, ValoresFiltro } from '@/modules/ger';
import { aplicarFiltros, validarValoresFiltro, type ConteudoExportacao, type GeradorExportacao } from '@/modules/ger/servidor';
import type { TxCliente } from '@/shared/db';
import { falha, ok, type Resultado } from '@/shared/kernel';
import { nosVisiveis, paraNoTela, paraNoTelaCc, type ColunaCc, type ColunaConta, type NoTela } from '../domain/arvore-tela';
import { listarArvoreCentrosCusto, listarArvoreContas } from '../infrastructure/estrutura-financeira';
import { COLUNAS_CC, COLUNAS_CONTAS, FILTROS_CC, FILTROS_CONTAS } from './filtros-estrutura';

// O conteúdo das exportações do plano de contas e dos centros de custo (US-024): as mesmas linhas da
// tela (paraNoTela), o mesmo "mostrar inativos", os mesmos filtros da grade e as mesmas colunas, na
// ordem da árvore. Usado na hora (exportar-estrutura.ts) e pelo worker (exportação assíncrona, pelo
// servidor.ts): sem server-only nem @/shared/authz.

// `filtros` chega bruto (da URL ou do pedido gravado): é validado pelas definições da tela.
export type ParametrosEstrutura = { incluirInativos: boolean; filtros?: unknown };

export type Arvore<C extends string> = {
  funcionalidade: 'cad.plano_contas' | 'cad.centros_custo';
  titulo: string;
  arquivo: string;
  colunas: readonly { campo: C; titulo: string; largura: number }[];
  filtros: readonly DefinicaoFiltro<C>[];
  nos: (tx: TxCliente) => Promise<readonly NoTela<C>[]>;
};

function emOrdem<C extends string>(nos: readonly NoTela<C>[]): NoTela<C>[] {
  return nos.flatMap((n) => [n, ...emOrdem(n.filhos ?? [])]);
}

/** Os filtros ativos, legíveis: o rótulo do filtro e o valor (o rótulo da opção, na seleção). */
function filtrosLegiveis<C extends string>(defs: readonly DefinicaoFiltro<C>[], valores: ValoresFiltro): FiltroExportacao[] {
  return defs.flatMap((d) => {
    const v = valores[d.id];
    if (d.tipo === 'texto' && typeof v === 'string' && v.trim() !== '') return [{ rotulo: d.rotulo, valor: v.trim() }];
    if (d.tipo === 'selecao' && typeof v === 'string' && v !== '') return [{ rotulo: d.rotulo, valor: d.opcoes.find((o) => o.valor === v)?.rotulo ?? v }];
    return [];
  });
}

/** Os filtros validados, só com as chaves das definições: é o que vai para o pedido assíncrono. */
export function validarFiltrosArvore<C extends string>(a: Arvore<C>, filtros: unknown): Resultado<ValoresFiltro> {
  return validarValoresFiltro(a.filtros as readonly DefinicaoFiltro[], filtros ?? {});
}

/** As linhas e os filtros legíveis do arquivo, lidos na transação recebida. */
export async function montarConteudo<C extends string>(tx: TxCliente, a: Arvore<C>, p: ParametrosEstrutura): Promise<Resultado<ConteudoExportacao>> {
  const v = validarFiltrosArvore(a, p.filtros);
  if (!v.ok) return falha(v.erros);
  const filtros = [{ rotulo: 'Inativos', valor: p.incluirInativos ? 'incluídos' : 'não incluídos' }, ...filtrosLegiveis(a.filtros, v.valor)];
  const visiveis = aplicarFiltros(nosVisiveis(await a.nos(tx), p.incluirInativos), a.filtros, v.valor).nos;
  const linhas = emOrdem(visiveis).map((n) => a.colunas.map((c) => n.linha[c.campo] ?? null));
  return ok({ planilha: { nome: a.titulo, colunas: a.colunas.map((c) => ({ titulo: c.titulo, tipo: 'texto' as const, largura: c.largura })), linhas }, filtros });
}

export const ARVORE_PLANO: Arvore<ColunaConta> = {
  funcionalidade: 'cad.plano_contas',
  titulo: 'Plano de contas',
  arquivo: 'plano-de-contas',
  colunas: COLUNAS_CONTAS,
  filtros: FILTROS_CONTAS,
  nos: async (tx) => (await listarArvoreContas(tx, { incluirInativos: true })).map(paraNoTela),
};

export const ARVORE_CENTROS: Arvore<ColunaCc> = {
  funcionalidade: 'cad.centros_custo',
  titulo: 'Centros de custo',
  arquivo: 'centros-de-custo',
  colunas: COLUNAS_CC,
  filtros: FILTROS_CC,
  nos: async (tx) => (await listarArvoreCentrosCusto(tx, { incluirInativos: true })).map(paraNoTelaCc),
};

// O pedido gravado vem do banco: só o booleano dos inativos é aceito; os filtros são validados no montarConteudo.
function gerador<C extends string>(a: Arvore<C>): GeradorExportacao {
  return (tx, parametros) => {
    const p = (typeof parametros === 'object' && parametros !== null ? parametros : {}) as Record<string, unknown>;
    if (typeof p.incluirInativos !== 'boolean') return Promise.resolve(falha([{ campo: 'incluirInativos', mensagem: 'Pedido de exportação inválido.' }]));
    return montarConteudo(tx, a, { incluirInativos: p.incluirInativos, filtros: p.filtros });
  };
}

/** Os geradores do cad para a exportação assíncrona, por funcionalidade (o worker os passa ao ger). */
export const GERADORES_EXPORTACAO_CAD: Readonly<Record<string, GeradorExportacao>> = {
  [ARVORE_PLANO.funcionalidade]: gerador(ARVORE_PLANO),
  [ARVORE_CENTROS.funcionalidade]: gerador(ARVORE_CENTROS),
};
