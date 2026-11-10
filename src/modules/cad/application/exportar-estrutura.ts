import 'server-only';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  aplicarFiltros,
  criarIdentificacao,
  validarValoresFiltro,
  type DefinicaoFiltro,
  type FiltroExportacao,
  type FormatoArquivo,
  type ValoresFiltro,
} from '@/modules/ger';
import { exportarCsv, exportarXlsx } from '@/modules/ger/servidor';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma, type TxCliente } from '@/shared/db';
import { falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { nosVisiveis, paraNoTela, paraNoTelaCc, type ColunaCc, type ColunaConta, type NoTela } from '../domain/arvore-tela';
import { listarArvoreCentrosCusto, listarArvoreContas } from '../infrastructure/estrutura-financeira';
import { FILTROS_CC, FILTROS_CONTAS } from '../ui/arvore-contas-logica';

// Exportação das listagens do plano de contas e dos centros de custo (US-024, partes 2 e 3; RN0011 e
// RN_WATERMARK pelo C3). O arquivo é o que a tela mostra: as mesmas linhas (paraNoTela), o mesmo
// "mostrar inativos", os mesmos filtros da grade (validados e aplicados pelo aplicarFiltros do ger,
// a função da própria Tree Grid) e as mesmas colunas, na ordem da árvore. Os filtros vão para o
// cabeçalho. O arquivo é gerado antes do Histórico (UC0.05); se a geração falhar, nada é gravado. O
// Histórico leva o formato, a quantidade de registros, os filtros e o rastreio.

// `filtros` chega bruto da URL (busca, tipo): é validado pelas definições da tela.
export type OpcoesExportacao = { formato: FormatoArquivo; incluirInativos: boolean; filtros?: unknown };
type Deps = { cliente?: PrismaClient };

class FalhaGeracao extends Error {
  constructor(readonly erros: ErroCampo[]) {
    super('geração do arquivo');
  }
}

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

type Arvore<C extends string> = {
  funcionalidade: 'cad.plano_contas' | 'cad.centros_custo';
  titulo: string;
  colunas: readonly { campo: C; titulo: string; largura: number }[];
  filtros: readonly DefinicaoFiltro<C>[];
  nos: (tx: TxCliente) => Promise<readonly NoTela<C>[]>;
};

async function exportarArvore<C extends string>(ctx: ContextoRequisicao, a: Arvore<C>, o: OpcoesExportacao, deps: Deps): Promise<Resultado<Uint8Array>> {
  exigir(ctx, a.funcionalidade, 'exportar');
  const v = validarValoresFiltro(a.filtros as readonly DefinicaoFiltro[], o.filtros ?? {});
  if (!v.ok) return falha(v.erros);
  const cliente = deps.cliente ?? prisma;
  try {
    const bytes = await cliente.$transaction(async (tx) => {
      const filtros = [{ rotulo: 'Inativos', valor: o.incluirInativos ? 'incluídos' : 'não incluídos' }, ...filtrosLegiveis(a.filtros, v.valor)];
      const identificacao = criarIdentificacao({ titulo: a.titulo, filtros, operador: ctx.usuarioRotulo });
      const visiveis = aplicarFiltros(nosVisiveis(await a.nos(tx), o.incluirInativos), a.filtros, v.valor).nos;
      const linhas = emOrdem(visiveis).map((n) => a.colunas.map((c) => n.linha[c.campo] ?? null));
      const planilha = { nome: a.titulo, colunas: a.colunas.map((c) => ({ titulo: c.titulo, tipo: 'texto' as const, largura: c.largura })), linhas, identificacao };
      const r = o.formato === 'xlsx' ? await exportarXlsx([planilha]) : exportarCsv(planilha);
      if (!r.ok) throw new FalhaGeracao([...r.erros]);
      await auditar(tx, {
        contexto: { usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip, unidadeId: null },
        funcionalidade: a.funcionalidade,
        tipo: 'EXPORTACAO',
        registroId: identificacao.rastreio,
        descricao: `${a.titulo} exportado em ${o.formato.toUpperCase()} (rastreio ${identificacao.rastreio})`,
        depois: { formato: o.formato, registros: linhas.length, filtros, rastreio: identificacao.rastreio },
      });
      return r.valor;
    });
    return ok(bytes);
  } catch (e) {
    if (e instanceof FalhaGeracao) return falha(e.erros);
    throw e;
  }
}

const PLANO: Arvore<ColunaConta> = {
  funcionalidade: 'cad.plano_contas',
  titulo: 'Plano de contas',
  colunas: [
    { campo: 'classificacao', titulo: 'Classificação', largura: 110 },
    { campo: 'reduzido', titulo: 'Reduzido', largura: 70 },
    { campo: 'descricao', titulo: 'Descrição', largura: 320 },
    { campo: 'nivel', titulo: 'Nível', largura: 50 },
    { campo: 'tipo', titulo: 'Tipo', largura: 80 },
    { campo: 'situacao', titulo: 'Situação', largura: 70 },
  ],
  filtros: FILTROS_CONTAS,
  nos: async (tx) => (await listarArvoreContas(tx, { incluirInativos: true })).map(paraNoTela),
};

const CENTROS: Arvore<ColunaCc> = {
  funcionalidade: 'cad.centros_custo',
  titulo: 'Centros de custo',
  colunas: [
    { campo: 'classificacao', titulo: 'Classificação', largura: 100 },
    { campo: 'reduzido', titulo: 'Reduzido', largura: 70 },
    { campo: 'descricao', titulo: 'Descrição', largura: 320 },
    { campo: 'nivel', titulo: 'Nível', largura: 50 },
    { campo: 'tipo', titulo: 'Tipo', largura: 80 },
    { campo: 'selos', titulo: 'Selos', largura: 120 },
    { campo: 'situacao', titulo: 'Situação', largura: 70 },
  ],
  filtros: FILTROS_CC,
  nos: async (tx) => (await listarArvoreCentrosCusto(tx, { incluirInativos: true })).map(paraNoTelaCc),
};

export const exportarPlanoContas = (ctx: ContextoRequisicao, o: OpcoesExportacao, deps: Deps = {}) => exportarArvore(ctx, PLANO, o, deps);
export const exportarCentrosCusto = (ctx: ContextoRequisicao, o: OpcoesExportacao, deps: Deps = {}) => exportarArvore(ctx, CENTROS, o, deps);
