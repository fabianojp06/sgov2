import 'server-only';
import type { PrismaClient } from '@/generated/prisma/client';
import { listarArvoreContas, sinteticasDoRelatorio } from '@/modules/cad';
import { criarIdentificacao, TIPOS_ARQUIVO, type FormatoArquivo, type PlanilhaExportacao } from '@/modules/ger';
import { gerarArquivo } from '@/modules/ger/servidor';
import { bensDaVersaoOficial, type TpDoRealizado } from '@/modules/orc';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma } from '@/shared/db';
import { falha, ok, type Resultado } from '@/shared/kernel';
import { montarAquisicoes, type Aquisicoes, type BemDoTp } from './aquisicoes-tp-montagem';
import { FalhaGeracao, filtrosDoTp, MENSAGENS_DESPESAS, nomeArquivoTp, type PortaRealizado } from './despesas-tp';
import { mesPorExtenso } from './despesas-tp-montagem';

// Demonstrativo de aquisições do TP (US-097 parte 2; UC05.04). Só leitura: os bens da versão oficializada e o realizado
// vêm das portas do orc (#544 e US-085), com a permissão (orc.realizado:consultar) e a RLS de lá; as contas, do C1, só
// as analíticas abaixo das sintéticas que a GFIN marcou como Imobilizado/Intangível (decisão do PO no #119). Filtros:
// TP, período, conta e descrição, combináveis (REQ0293 a 0295). O aditivo (REQ0293) entra com os aditivos do TP.

export const FUNCIONALIDADE_AQUISICOES = 'rel.aquisicoes_tp';

export const MENSAGENS_AQUISICOES = {
  SEM_CONTAS:
    'Nenhuma conta do Imobilizado/Intangível marcada no plano de contas. A GFIN marca em Cadastros › Plano de contas › Contas dos relatórios.',
  TOTAL_GERAL: 'Total Geral de Aquisições',
} as const;

/** Os bens da versão oficializada (`bensDaVersaoOficial`, #544); injetável nos testes. */
export type PortaBens = (ctx: ContextoRequisicao, filtro: { tp: string }) => Promise<{ versao: number | null; itens: readonly BemDoTp[] } | null>;

export type TelaAquisicoes = {
  tps: readonly TpDoRealizado[];
  filtros: { tp: string; de: string; ate: string; exibirZerados: boolean; conta: string; descricao: string };
  relatorio: (Aquisicoes & { tp: TpDoRealizado; versao: number | null; atualizadoEm: Date | null }) | null;
  erro: string | null;
};

type Deps = { agora?: () => Date; contas?: typeof listarArvoreContas; sinteticas?: () => Promise<readonly string[]>; bens?: PortaBens };

const texto = (bruto: unknown, campo: string) => {
  const v = ((bruto ?? {}) as Record<string, unknown>)[campo];
  const t = Array.isArray(v) ? v[0] : v;
  return typeof t === 'string' ? t.trim().slice(0, 80) : '';
};

export async function obterAquisicoesTp(ctx: ContextoRequisicao, bruto: unknown, porta: PortaRealizado, deps: Deps = {}): Promise<TelaAquisicoes> {
  exigir(ctx, FUNCIONALIDADE_AQUISICOES, 'consultar');
  const extra = { conta: texto(bruto, 'conta'), descricao: texto(bruto, 'descricao') };
  const f = await filtrosDoTp(ctx, bruto, porta, (deps.agora ?? (() => new Date()))());
  if (!f.pronto) return { tps: f.tps, filtros: { ...f.filtros, ...extra }, relatorio: null, erro: f.erro };
  const { tps, tp } = f;
  const filtros = { ...f.filtros, ...extra };
  const raizes = await (deps.sinteticas ?? (() => sinteticasDoRelatorio(prisma, 'imobilizado')))();
  if (raizes.length === 0) return { tps, filtros, relatorio: null, erro: MENSAGENS_AQUISICOES.SEM_CONTAS };
  const [realizado, bens, arvore] = await Promise.all([
    porta.realizado(ctx, { tp: tp.numero, de: filtros.de, ate: filtros.ate }),
    (deps.bens ?? bensDaVersaoOficial)(ctx, { tp: tp.numero }),
    (deps.contas ?? listarArvoreContas)(prisma, { incluirInativos: true }),
  ]);
  if (!realizado || !bens) return { tps, filtros, relatorio: null, erro: MENSAGENS_DESPESAS.TP_INEXISTENTE };
  const a = montarAquisicoes(arvore, raizes, bens.itens, realizado.linhas, filtros.de, filtros.ate, {
    anoAtual: f.anoAtual,
    conta: filtros.conta,
    descricao: filtros.descricao,
    exibirZerados: filtros.exibirZerados,
  });
  return { tps, filtros, relatorio: { ...a, tp, versao: bens.versao, atualizadoEm: realizado.atualizadoEm }, erro: null };
}

/** A planilha (a mesma da tela): a conta com o previsto por coluna, o total e o realizado; abaixo, os bens. */
export function planilhaAquisicoes(r: NonNullable<TelaAquisicoes['relatorio']>, identificacao: PlanilhaExportacao['identificacao']): PlanilhaExportacao {
  const vazias = r.colunas.map(() => null);
  return {
    nome: 'Aquisições',
    colunas: [
      { titulo: 'Conta', tipo: 'texto', largura: 110 },
      { titulo: 'Descrição', tipo: 'texto', largura: 240 },
      { titulo: 'Data', tipo: 'texto', largura: 70 },
      { titulo: 'Quantidade', tipo: 'texto', largura: 60 },
      { titulo: 'Valor unitário', tipo: 'dinheiro' },
      ...r.colunas.map((c) => ({ titulo: c.rotulo, tipo: 'dinheiro' as const })),
      { titulo: 'Total previsto', tipo: 'dinheiro' },
      { titulo: 'Realizado', tipo: 'dinheiro' },
    ],
    linhas: [
      ...r.contas.flatMap((c) => [
        [c.classificacao, `${c.descricao}${c.inativa ? ' (inativa)' : ''}`, '', '', null, ...c.valores, c.total, c.realizado],
        ...c.itens.map((i) => [
          '',
          `  ${i.descricao}`,
          i.data.split('-').reverse().join('/'),
          String(i.quantidade),
          i.valorUnitario,
          ...vazias.map((_, k) => (k === i.coluna ? i.valorTotal : null)),
          i.valorTotal,
          null,
        ]),
      ]),
      ['', MENSAGENS_AQUISICOES.TOTAL_GERAL, '', '', null, ...r.totalGeral.valores, r.totalGeral.total, r.totalGeral.realizado],
      ...(r.foraDasContas.quantidade > 0
        ? [['', `Fora do demonstrativo: ${r.foraDasContas.quantidade} bem(ns) em conta fora do Imobilizado/Intangível`, '', '', null, ...vazias, r.foraDasContas.valor, null]]
        : []),
    ],
    ...(identificacao ? { identificacao } : {}),
  };
}

/** Exporta o demonstrativo (rel.aquisicoes_tp:exportar) em XLSX, CSV ou PDF, com a EXPORTACAO no Histórico. */
export async function exportarAquisicoesTp(
  ctx: ContextoRequisicao,
  bruto: unknown,
  formato: FormatoArquivo,
  porta: PortaRealizado,
  deps: Deps & { cliente?: PrismaClient } = {},
): Promise<Resultado<{ nome: string; tipo: string; bytes: Uint8Array }>> {
  exigir(ctx, FUNCIONALIDADE_AQUISICOES, 'exportar');
  const tela = await obterAquisicoesTp(ctx, bruto, porta, deps);
  if (!tela.relatorio) return falha([{ campo: '_', mensagem: tela.erro ?? MENSAGENS_DESPESAS.ESCOLHA_TP }]);
  const r = tela.relatorio;
  const t = tela.filtros;
  const filtros = [
    { rotulo: 'Termo de Parceria', valor: `${r.tp.numero} - ${r.tp.objeto}` },
    { rotulo: 'Período', valor: `${mesPorExtenso(t.de)} a ${mesPorExtenso(t.ate)}` },
    ...(t.conta ? [{ rotulo: 'Conta', valor: t.conta }] : []),
    ...(t.descricao ? [{ rotulo: 'Descrição', valor: t.descricao }] : []),
    { rotulo: 'Previsto', valor: r.versao === null ? 'Sem versão oficializada' : `Bens da versão ${r.versao}` },
  ];
  const identificacao = criarIdentificacao({ titulo: `Demonstrativo de aquisições - ${r.tp.objeto}`, filtros, operador: ctx.usuarioRotulo });
  try {
    const bytes = await (deps.cliente ?? prisma).$transaction(async (tx) => {
      const p = planilhaAquisicoes(r, identificacao);
      const g = await gerarArquivo(formato, [p]);
      if (!g.ok) throw new FalhaGeracao(g.erros);
      await auditar(tx, {
        contexto: { usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip, unidadeId: null },
        funcionalidade: FUNCIONALIDADE_AQUISICOES,
        tipo: 'EXPORTACAO',
        registroId: r.tp.numero,
        descricao: `Demonstrativo de aquisições do TP ${r.tp.numero} exportado em ${formato.toUpperCase()} (rastreio ${identificacao.rastreio})`,
        depois: { formato, registros: p.linhas.length, filtros, rastreio: identificacao.rastreio },
      });
      return g.valor;
    });
    return ok({ nome: nomeArquivoTp('aquisicoes', r.tp.numero, formato), tipo: TIPOS_ARQUIVO[formato], bytes });
  } catch (e) {
    if (e instanceof FalhaGeracao) return falha(e.erros);
    throw e;
  }
}
