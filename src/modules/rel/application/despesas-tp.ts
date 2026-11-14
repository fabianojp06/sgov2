import 'server-only';
import { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import { listarArvoreContas } from '@/modules/cad';
import { criarIdentificacao, TIPOS_ARQUIVO, type FormatoArquivo, type PlanilhaExportacao } from '@/modules/ger';
import { gerarArquivo } from '@/modules/ger/servidor';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma } from '@/shared/db';
import { falha, ok, type Dinheiro, type Resultado } from '@/shared/kernel';
import { ehCompetencia, montarDespesas, type Despesas, type LinhaRealizado } from './despesas-tp-montagem';

// Demonstrativo de despesas do TP (US-096 parte 1; UC05.02, 2ª tabela). Só leitura: o realizado vem da porta
// do orc (US-085), com a permissão e a RLS dela; as contas, do C1. Filtros: o TP (obrigatório, RN0234), o
// período (padrão: a vigência inteira até o mês atual, RN0294) e "exibir zerados" (RN0383). Só TP com versão
// oficial (RN0385). A 1ª tabela (recursos financeiros e rendimentos, REQ0257/0265) depende das aplicações
// financeiras (US-088) e fica para a parte 2.

export const FUNCIONALIDADE_DESPESAS = 'rel.despesas_tp';

export type TpDoRealizado = { numero: string; objeto: string; inicio: string; fim: string; versaoOficial: number | null };
export type RealizadoDoTp = {
  linhas: readonly LinhaRealizado[];
  ajustes: readonly { conta: string; origem: string; lancamento: string; valor: Dinheiro }[];
  pendencias: { quantidade: number; valor: Dinheiro };
  atualizadoEm: Date | null;
};
/** A porta do realizado do orc (US-085), injetada: a página passa a real. */
export type PortaRealizado = {
  tps: (ctx: ContextoRequisicao) => Promise<readonly TpDoRealizado[]>;
  realizado: (ctx: ContextoRequisicao, filtro: { tp: string; de: string; ate: string }) => Promise<RealizadoDoTp>;
};

export const MENSAGENS_DESPESAS = {
  ESCOLHA_TP: 'Escolha o Termo de Parceria.',
  TP_INEXISTENTE: 'Termo de Parceria não encontrado ou sem versão oficial.',
  PERIODO_INVALIDO: 'Período inválido: use o formato AAAA-MM, com o início antes do fim.',
  FORA_DA_VIGENCIA: 'O período precisa estar dentro da vigência do Termo de Parceria.',
} as const;

const FILTROS = z.object({
  tp: z.string().max(60).optional(),
  de: z.string().max(7).optional(),
  ate: z.string().max(7).optional(),
  zerados: z.enum(['', 'sim']).optional(),
});

export type TelaDespesas = {
  tps: readonly TpDoRealizado[];
  filtros: { tp: string; de: string; ate: string; exibirZerados: boolean };
  /** Null enquanto o TP não foi escolhido (RN0234) ou com filtro inválido. */
  relatorio: (Despesas & { tp: TpDoRealizado; atualizadoEm: Date | null; pendencias: { quantidade: number; valor: string }; ajustes: number }) | null;
  erro: string | null;
};

const mesAtual = (agora: Date) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(agora);
  return `${p.find((x) => x.type === 'year')!.value}-${p.find((x) => x.type === 'month')!.value}`;
};

export async function obterDespesasTp(
  ctx: ContextoRequisicao,
  bruto: unknown,
  porta: PortaRealizado,
  deps: { agora?: () => Date; contas?: typeof listarArvoreContas } = {},
): Promise<TelaDespesas> {
  exigir(ctx, FUNCIONALIDADE_DESPESAS, 'consultar');
  // Só TP com versão oficial (RN0385).
  const tps = (await porta.tps(ctx)).filter((t) => t.versaoOficial !== null);
  const f = FILTROS.safeParse(bruto);
  const vazio = { tp: '', de: '', ate: '', exibirZerados: false };
  if (!f.success) return { tps, filtros: vazio, relatorio: null, erro: MENSAGENS_DESPESAS.PERIODO_INVALIDO };
  const filtros = { tp: f.data.tp?.trim() ?? '', de: f.data.de ?? '', ate: f.data.ate ?? '', exibirZerados: f.data.zerados === 'sim' };
  if (!filtros.tp) return { tps, filtros, relatorio: null, erro: null };
  const tp = tps.find((t) => t.numero === filtros.tp);
  if (!tp) return { tps, filtros, relatorio: null, erro: MENSAGENS_DESPESAS.TP_INEXISTENTE };
  // Período padrão: a vigência inteira, até o mês atual (RN0294; o que ainda não aconteceu não tem realizado).
  const atual = mesAtual((deps.agora ?? (() => new Date()))());
  const de = filtros.de || tp.inicio;
  const ate = filtros.ate || (tp.fim < atual ? tp.fim : atual);
  if (!ehCompetencia(de) || !ehCompetencia(ate) || de > ate) return { tps, filtros, relatorio: null, erro: MENSAGENS_DESPESAS.PERIODO_INVALIDO };
  if (de < tp.inicio || ate > tp.fim) return { tps, filtros, relatorio: null, erro: MENSAGENS_DESPESAS.FORA_DA_VIGENCIA };
  const [realizado, arvore] = await Promise.all([porta.realizado(ctx, { tp: tp.numero, de, ate }), (deps.contas ?? listarArvoreContas)(prisma)]);
  const d = montarDespesas(arvore, realizado.linhas, de, ate, { exibirZerados: filtros.exibirZerados });
  return {
    tps,
    filtros: { ...filtros, de, ate },
    relatorio: {
      ...d,
      tp,
      atualizadoEm: realizado.atualizadoEm,
      pendencias: { quantidade: realizado.pendencias.quantidade, valor: realizado.pendencias.valor.paraString() },
      ajustes: realizado.ajustes.length,
    },
    erro: null,
  };
}


class FalhaGeracao extends Error {
  constructor(readonly erros: readonly { campo: string; mensagem: string }[]) {
    super('falha na geração do arquivo');
  }
}

/** A planilha do demonstrativo (a mesma da tela): conta, descrição com recuo, as colunas e o total. */
export function planilhaDespesas(tela: NonNullable<TelaDespesas['relatorio']>, identificacao: PlanilhaExportacao['identificacao']): PlanilhaExportacao {
  const recuo = (n: number) => '  '.repeat(n);
  return {
    nome: 'Despesas',
    colunas: [
      { titulo: 'Conta', tipo: 'texto', largura: 110 },
      { titulo: 'Descrição', tipo: 'texto', largura: 260 },
      ...tela.colunas.map((c) => ({ titulo: c.rotulo, tipo: 'dinheiro' as const })),
      { titulo: 'Total', tipo: 'dinheiro' },
    ],
    linhas: [
      ...tela.linhas.map((l) => [l.classificacao, `${recuo(l.nivel)}${l.descricao}`, ...l.valores, l.total]),
      ['', 'Total Geral Termo de Parceria', ...tela.totalGeral.valores, tela.totalGeral.total],
    ],
    ...(identificacao ? { identificacao } : {}),
  };
}

/** Exporta o demonstrativo (rel.despesas_tp:exportar) em XLSX, CSV ou PDF, com a EXPORTACAO no Histórico. */
export async function exportarDespesasTp(
  ctx: ContextoRequisicao,
  bruto: unknown,
  formato: FormatoArquivo,
  porta: PortaRealizado,
  deps: { agora?: () => Date; contas?: typeof listarArvoreContas; cliente?: PrismaClient } = {},
): Promise<Resultado<{ nome: string; tipo: string; bytes: Uint8Array }>> {
  exigir(ctx, FUNCIONALIDADE_DESPESAS, 'exportar');
  const tela = await obterDespesasTp(ctx, bruto, porta, deps);
  if (!tela.relatorio) return falha([{ campo: '_', mensagem: tela.erro ?? MENSAGENS_DESPESAS.ESCOLHA_TP }]);
  const r = tela.relatorio;
  const filtros = [
    { rotulo: 'Termo de Parceria', valor: `${r.tp.numero} - ${r.tp.objeto}` },
    { rotulo: 'Período', valor: `${tela.filtros.de} a ${tela.filtros.ate}` },
    { rotulo: 'Exibir zerados', valor: tela.filtros.exibirZerados ? 'Sim' : 'Não' },
  ];
  const identificacao = criarIdentificacao({ titulo: `Demonstrativo de despesas - ${r.tp.objeto}`, filtros, operador: ctx.usuarioRotulo });
  try {
    const bytes = await (deps.cliente ?? prisma).$transaction(async (tx) => {
      const p = planilhaDespesas(r, identificacao);
      const g = await gerarArquivo(formato, [p]);
      if (!g.ok) throw new FalhaGeracao(g.erros);
      await auditar(tx, {
        contexto: { usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip, unidadeId: null },
        funcionalidade: FUNCIONALIDADE_DESPESAS,
        tipo: 'EXPORTACAO',
        registroId: r.tp.numero,
        descricao: `Demonstrativo de despesas do TP ${r.tp.numero} exportado em ${formato.toUpperCase()} (rastreio ${identificacao.rastreio})`,
        depois: { formato, registros: p.linhas.length, filtros, rastreio: identificacao.rastreio },
      });
      return g.valor;
    });
    return ok({ nome: `despesas-${r.tp.numero.replace(/[^\w-]+/g, '_')}.${formato}`, tipo: TIPOS_ARQUIVO[formato], bytes });
  } catch (e) {
    if (e instanceof FalhaGeracao) return falha(e.erros);
    throw e;
  }
}
