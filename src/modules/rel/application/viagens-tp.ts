import 'server-only';
import type { PrismaClient } from '@/generated/prisma/client';
import { listarArvoreContas, sinteticasDoRelatorio } from '@/modules/cad';
import { criarIdentificacao, TIPOS_ARQUIVO, type FormatoArquivo, type PlanilhaExportacao } from '@/modules/ger';
import { gerarArquivo } from '@/modules/ger/servidor';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma } from '@/shared/db';
import type { TpDoRealizado } from '@/modules/orc';
import { falha, ok, type Resultado } from '@/shared/kernel';
import { FalhaGeracao, filtrosDoTp, MENSAGENS_DESPESAS, nomeArquivoTp, type PortaRealizado } from './despesas-tp';
import { mesPorExtenso, montarDespesas, podarPorTexto, type Despesas } from './despesas-tp-montagem';

// Demonstrativo analítico de despesas com viagens do TP (US-097 parte 1; UC05.03). Só leitura: o realizado vem da
// porta do orc (REQ0280/0284, RN0407), com a permissão e a RLS dela; as contas, do C1, só as analíticas abaixo das
// sintéticas que a GFIN marcou como "Viagens e diárias" no plano de contas (decisão do PO no #119), agrupadas pelas
// sintéticas intermediárias (REQ0279), que somam as analíticas (REQ0285/0286), com o total geral (REQ0287). Os
// filtros e as colunas são os do demonstrativo de despesas (TP, período, zerados), mais conta ou descrição
// (REQ0281/0282). Os campos sem valor saem 0 (REQ0283).

export const FUNCIONALIDADE_VIAGENS = 'rel.viagens_tp';

export const MENSAGENS_VIAGENS = {
  SEM_CONTAS:
    'Nenhuma conta de viagens marcada no plano de contas. A GFIN marca em Cadastros › Plano de contas › Contas dos relatórios.',
  TOTAL_GERAL: 'Total Geral de Viagens e Diárias',
} as const;

export type TelaViagens = {
  tps: readonly TpDoRealizado[];
  filtros: { tp: string; de: string; ate: string; exibirZerados: boolean; texto: string };
  relatorio: (Omit<Despesas, 'foraDaArvore'> & { tp: TpDoRealizado; atualizadoEm: Date | null; pendencias: { quantidade: number; valor: string }; ajustes: number }) | null;
  erro: string | null;
};

type Deps = { agora?: () => Date; contas?: typeof listarArvoreContas; sinteticas?: () => Promise<readonly string[]> };

const textoDoFiltro = (bruto: unknown) => {
  const v = ((bruto ?? {}) as Record<string, unknown>).texto;
  const t = Array.isArray(v) ? v[0] : v;
  return typeof t === 'string' ? t.trim().slice(0, 80) : '';
};

export async function obterViagensTp(ctx: ContextoRequisicao, bruto: unknown, porta: PortaRealizado, deps: Deps = {}): Promise<TelaViagens> {
  exigir(ctx, FUNCIONALIDADE_VIAGENS, 'consultar');
  const texto = textoDoFiltro(bruto);
  const f = await filtrosDoTp(ctx, bruto, porta, (deps.agora ?? (() => new Date()))());
  if (!f.pronto) return { tps: f.tps, filtros: { ...f.filtros, texto }, relatorio: null, erro: f.erro };
  const { tps, tp } = f;
  const filtros = { ...f.filtros, texto };
  const raizes = await (deps.sinteticas ?? (() => sinteticasDoRelatorio(prisma, 'viagens')))();
  if (raizes.length === 0) return { tps, filtros, relatorio: null, erro: MENSAGENS_VIAGENS.SEM_CONTAS };
  const [realizado, arvore] = await Promise.all([
    porta.realizado(ctx, { tp: tp.numero, de: filtros.de, ate: filtros.ate }),
    (deps.contas ?? listarArvoreContas)(prisma, { incluirInativos: true }),
  ]);
  if (!realizado) return { tps, filtros, relatorio: null, erro: MENSAGENS_DESPESAS.TP_INEXISTENTE };
  // O realizado das outras contas do TP não é "fora" aqui: o demonstrativo é só de viagens.
  const { colunas, linhas, totalGeral } = montarDespesas(podarPorTexto(arvore, texto), realizado.linhas, filtros.de, filtros.ate, {
    exibirZerados: filtros.exibirZerados,
    anoAtual: f.anoAtual,
    raizes,
  });
  return {
    tps,
    filtros,
    relatorio: {
      colunas,
      linhas,
      totalGeral,
      tp,
      atualizadoEm: realizado.atualizadoEm,
      pendencias: { quantidade: realizado.pendencias.quantidade, valor: realizado.pendencias.valor.paraString() },
      ajustes: realizado.ajustes.length,
    },
    erro: null,
  };
}

/** A planilha do demonstrativo (a mesma da tela): conta, descrição com recuo, as colunas e o total. */
export function planilhaViagens(r: NonNullable<TelaViagens['relatorio']>, identificacao: PlanilhaExportacao['identificacao']): PlanilhaExportacao {
  const recuo = (n: number) => '  '.repeat(n);
  return {
    nome: 'Viagens',
    colunas: [
      { titulo: 'Conta', tipo: 'texto', largura: 110 },
      { titulo: 'Descrição', tipo: 'texto', largura: 260 },
      ...r.colunas.map((c) => ({ titulo: c.rotulo, tipo: 'dinheiro' as const })),
      { titulo: 'Total', tipo: 'dinheiro' },
    ],
    linhas: [
      ...r.linhas.map((l) => [l.classificacao, `${recuo(l.nivel)}${l.descricao}${l.inativa ? ' (inativa)' : ''}`, ...l.valores, l.total]),
      ['', MENSAGENS_VIAGENS.TOTAL_GERAL, ...r.totalGeral.valores, r.totalGeral.total],
    ],
    ...(identificacao ? { identificacao } : {}),
  };
}

/** Exporta o demonstrativo (rel.viagens_tp:exportar) em XLSX, CSV ou PDF, com a EXPORTACAO no Histórico. */
export async function exportarViagensTp(
  ctx: ContextoRequisicao,
  bruto: unknown,
  formato: FormatoArquivo,
  porta: PortaRealizado,
  deps: Deps & { cliente?: PrismaClient } = {},
): Promise<Resultado<{ nome: string; tipo: string; bytes: Uint8Array }>> {
  exigir(ctx, FUNCIONALIDADE_VIAGENS, 'exportar');
  const tela = await obterViagensTp(ctx, bruto, porta, deps);
  if (!tela.relatorio) return falha([{ campo: '_', mensagem: tela.erro ?? MENSAGENS_DESPESAS.ESCOLHA_TP }]);
  const r = tela.relatorio;
  const filtros = [
    { rotulo: 'Termo de Parceria', valor: `${r.tp.numero} - ${r.tp.objeto}` },
    { rotulo: 'Período', valor: `${mesPorExtenso(tela.filtros.de)} a ${mesPorExtenso(tela.filtros.ate)}` },
    ...(tela.filtros.texto ? [{ rotulo: 'Conta ou descrição', valor: tela.filtros.texto }] : []),
    { rotulo: 'Exibir zerados', valor: tela.filtros.exibirZerados ? 'Sim' : 'Não' },
  ];
  const identificacao = criarIdentificacao({ titulo: `Demonstrativo de despesas com viagens - ${r.tp.objeto}`, filtros, operador: ctx.usuarioRotulo });
  try {
    const bytes = await (deps.cliente ?? prisma).$transaction(async (tx) => {
      const p = planilhaViagens(r, identificacao);
      const g = await gerarArquivo(formato, [p]);
      if (!g.ok) throw new FalhaGeracao(g.erros);
      await auditar(tx, {
        contexto: { usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip, unidadeId: null },
        funcionalidade: FUNCIONALIDADE_VIAGENS,
        tipo: 'EXPORTACAO',
        registroId: r.tp.numero,
        descricao: `Demonstrativo de despesas com viagens do TP ${r.tp.numero} exportado em ${formato.toUpperCase()} (rastreio ${identificacao.rastreio})`,
        depois: { formato, registros: p.linhas.length, filtros, rastreio: identificacao.rastreio },
      });
      return g.valor;
    });
    return ok({ nome: nomeArquivoTp('viagens', r.tp.numero, formato), tipo: TIPOS_ARQUIVO[formato], bytes });
  } catch (e) {
    if (e instanceof FalhaGeracao) return falha(e.erros);
    throw e;
  }
}
