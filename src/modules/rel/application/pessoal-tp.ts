import 'server-only';
import { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import { criarIdentificacao, TIPOS_ARQUIVO, type FormatoArquivo, type PlanilhaExportacao } from '@/modules/ger';
import { gerarArquivo } from '@/modules/ger/servidor';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma } from '@/shared/db';
import { falha, ok, type Resultado } from '@/shared/kernel';
import { empregadosDaVersaoOficial, tpsDoRealizado, type TpDoRealizado } from '@/modules/orc';
import { FalhaGeracao, nomeArquivoTp } from './despesas-tp';
import { ehCompetencia, mesPorExtenso } from './despesas-tp-montagem';
import {
  CATEGORIAS_PESSOAL,
  linhasDePessoal,
  porSetor,
  ROTULO_CATEGORIA,
  totalCustos,
  type CategoriaPessoal,
  type EmpregadoDaVersao,
  type LinhaPessoal,
} from './pessoal-tp-montagem';

// Relatórios de pessoal do TP (US-098; UC05.05 Salários e UC05.06 Distribuição de pessoal). Só leitura (REQ0330/0337):
// os empregados vêm da versão oficializada pela porta do orc (`empregadosDaVersaoOficial`, #544; decisão do PO no
// #120), com a permissão (orc.realizado:consultar), a RLS e o mascaramento do custo de lá. A tela deixa claro que é o
// previsto na versão oficial, até a integração com a folha (RN0437): o valor é o custo mensal previsto, não o salário
// pago. Filtros: TP (obrigatório, só com versão oficial), período (padrão: a vigência), cargo, meta e categoria.

export const FUNCIONALIDADE_SALARIOS = 'rel.salarios_tp';
export const FUNCIONALIDADE_DISTRIBUICAO = 'rel.distribuicao_pessoal_tp';

type TpDoPessoal = TpDoRealizado;
/** `veCusto`: o perfil vê o custo do pessoal; sem ele, `custoMensal` vem nulo. `homologado`: o lote de pessoal da versão. */
export type PessoalDaVersao = { versao: number | null; porMeta: boolean; veCusto: boolean; homologado: boolean; empregados: readonly EmpregadoDaVersao[] };
/** A porta de pessoal do orc (#544); injetável nos testes. */
export type PortaPessoal = {
  tps: (ctx: ContextoRequisicao) => Promise<readonly TpDoPessoal[]>;
  pessoal: (ctx: ContextoRequisicao, filtro: { tp: string }) => Promise<PessoalDaVersao | null>;
};

export const MENSAGENS_PESSOAL = {
  ESCOLHA_TP: 'Escolha o Termo de Parceria.',
  TP_INEXISTENTE: 'Termo de Parceria não encontrado ou sem versão oficial.',
  PERIODO_INVALIDO: 'Período inválido: use o formato AAAA-MM, com o início antes do fim.',
  FILTRO_INVALIDO: 'Filtro inválido. Confira o período (AAAA-MM), o cargo, a meta e a categoria.',
  FORA_DA_VIGENCIA: 'O período precisa estar dentro da vigência do Termo de Parceria.',
  SEM_ACESSO: 'O seu perfil não consulta a versão oficializada dos Termos de Parceria (Orçamento › Realizado). Contate o Administrador.',
  ORIGEM: (v: number) => `Previsto na versão oficializada ${v} da proposta (não é a folha de pagamento).`,
} as const;

const FILTROS = z.object({
  tp: z.string().max(60).optional(),
  de: z.string().max(7).optional(),
  ate: z.string().max(7).optional(),
  cargo: z.string().max(80).optional(),
  meta: z.string().max(80).optional(),
  categoria: z.enum(['', ...CATEGORIAS_PESSOAL]).optional(),
});

export type TelaPessoal = {
  tps: readonly TpDoPessoal[];
  filtros: { tp: string; de: string; ate: string; cargo: string; meta: string; categoria: CategoriaPessoal | '' };
  relatorio: {
    tp: TpDoPessoal;
    versao: number;
    porMeta: boolean;
    linhas: LinhaPessoal[];
    /** Nulo: o perfil não vê o custo. */
    totalCustos: string | null;
    homologado: boolean;
    grupos: { setor: string; linhas: LinhaPessoal[] }[];
  } | null;
  erro: string | null;
};

const primeiro = (v: unknown) => (Array.isArray(v) ? v[0] : v);

async function obterPessoal(ctx: ContextoRequisicao, bruto: unknown, porta: PortaPessoal): Promise<TelaPessoal> {
  const vazio = { tp: '', de: '', ate: '', cargo: '', meta: '', categoria: '' as const };
  // A porta é a do realizado do orc: sem a permissão dele, a mensagem (e não um erro na página).
  if (!ctx.permissoes.has('orc.realizado:consultar')) return { tps: [], filtros: vazio, relatorio: null, erro: MENSAGENS_PESSOAL.SEM_ACESSO };
  const tps = (await porta.tps(ctx)).filter((t) => t.versaoOficial !== null);
  const b = (bruto ?? {}) as Record<string, unknown>;
  const f = FILTROS.safeParse(Object.fromEntries(['tp', 'de', 'ate', 'cargo', 'meta', 'categoria'].map((k) => [k, primeiro(b[k])])));
  if (!f.success) return { tps, filtros: vazio, relatorio: null, erro: MENSAGENS_PESSOAL.FILTRO_INVALIDO };
  const d = f.data;
  const filtros = { tp: d.tp?.trim() ?? '', de: d.de ?? '', ate: d.ate ?? '', cargo: d.cargo?.trim() ?? '', meta: d.meta?.trim() ?? '', categoria: d.categoria ?? '' };
  if (!filtros.tp) return { tps, filtros, relatorio: null, erro: null };
  const tp = tps.find((t) => t.numero === filtros.tp);
  if (!tp) return { tps, filtros, relatorio: null, erro: MENSAGENS_PESSOAL.TP_INEXISTENTE };
  const de = filtros.de || tp.inicio;
  const ate = filtros.ate || tp.fim;
  if (!ehCompetencia(de) || !ehCompetencia(ate) || de > ate) return { tps, filtros, relatorio: null, erro: MENSAGENS_PESSOAL.PERIODO_INVALIDO };
  if (de < tp.inicio || ate > tp.fim) return { tps, filtros, relatorio: null, erro: MENSAGENS_PESSOAL.FORA_DA_VIGENCIA };
  const comPeriodo = { ...filtros, de, ate };
  const pessoal = await porta.pessoal(ctx, { tp: tp.numero });
  if (!pessoal || pessoal.versao === null) return { tps, filtros: comPeriodo, relatorio: null, erro: MENSAGENS_PESSOAL.TP_INEXISTENTE };
  // TP consolidado não tem meta (RN0245): o filtro de meta não vale e não vai para o arquivo nem para o Histórico.
  if (!pessoal.porMeta) comPeriodo.meta = '';
  const linhas = linhasDePessoal(pessoal.empregados, comPeriodo, pessoal.porMeta);
  return {
    tps,
    filtros: comPeriodo,
    relatorio: {
      tp,
      versao: pessoal.versao,
      porMeta: pessoal.porMeta,
      linhas,
      totalCustos: totalCustos(linhas, pessoal.veCusto),
      homologado: pessoal.homologado,
      grupos: porSetor(linhas),
    },
    erro: null,
  };
}

/** UC05.05: os salários dos empregados do TP. */
export async function obterSalariosTp(ctx: ContextoRequisicao, bruto: unknown, porta: PortaPessoal): Promise<TelaPessoal> {
  exigir(ctx, FUNCIONALIDADE_SALARIOS, 'consultar');
  return obterPessoal(ctx, bruto, porta);
}

/** UC05.06: a distribuição de pessoal do TP, por setor. */
export async function obterDistribuicaoTp(ctx: ContextoRequisicao, bruto: unknown, porta: PortaPessoal): Promise<TelaPessoal> {
  exigir(ctx, FUNCIONALIDADE_DISTRIBUICAO, 'consultar');
  return obterPessoal(ctx, bruto, porta);
}

type Relatorio = NonNullable<TelaPessoal['relatorio']>;
const meta = (r: Relatorio) => (r.porMeta ? [{ titulo: 'Meta', tipo: 'texto' as const, largura: 160 }] : []);

/** A planilha de salários (a mesma da tela), com o total de empregados (REQ0332) e o dos custos mensais. */
export function planilhaSalarios(r: Relatorio, identificacao: PlanilhaExportacao['identificacao']): PlanilhaExportacao {
  const veCusto = r.totalCustos !== null;
  return {
    nome: 'Salários',
    colunas: [
      { titulo: 'Seq', tipo: 'texto', largura: 40 },
      { titulo: 'Nome', tipo: 'texto', largura: 200 },
      { titulo: 'Cargo', tipo: 'texto', largura: 200 },
      { titulo: 'Categoria', tipo: 'texto', largura: 100 },
      ...meta(r),
      { titulo: 'Início', tipo: 'texto', largura: 70 },
      { titulo: 'Fim', tipo: 'texto', largura: 70 },
      ...(veCusto ? [{ titulo: 'Custo mensal previsto', tipo: 'dinheiro' as const }] : []),
    ],
    linhas: [
      ...r.linhas.map((l) => [String(l.seq), l.nome, l.cargo, l.categoria, ...(r.porMeta ? [l.meta ?? ''] : []), l.inicio, l.fim, ...(veCusto ? [l.custo ?? '0.00'] : [])]),
      ['', `Total de empregados: ${r.linhas.length}`, '', '', ...(r.porMeta ? [''] : []), '', '', ...(veCusto ? [r.totalCustos] : [])],
    ],
    ...(identificacao ? { identificacao } : {}),
  };
}

/** A planilha da distribuição (a mesma da tela): uma linha de setor antes dos seus empregados e o total (REQ0338). */
export function planilhaDistribuicao(r: Relatorio, identificacao: PlanilhaExportacao['identificacao']): PlanilhaExportacao {
  const vazio = r.porMeta ? ['', '', '', ''] : ['', '', ''];
  return {
    nome: 'Distribuição',
    colunas: [
      { titulo: 'Seq', tipo: 'texto', largura: 40 },
      { titulo: 'Setor / Nome', tipo: 'texto', largura: 240 },
      { titulo: 'Cargo', tipo: 'texto', largura: 200 },
      { titulo: 'Categoria', tipo: 'texto', largura: 100 },
      ...meta(r),
    ],
    linhas: [
      ...r.grupos.flatMap((g) => [
        ['', `${g.setor}: ${g.linhas.length} empregado(s)`, ...vazio.slice(1)],
        ...g.linhas.map((l) => [String(l.seq), `  ${l.nome}`, l.cargo, l.categoria, ...(r.porMeta ? [l.meta ?? ''] : [])]),
      ]),
      ['', `Total de empregados: ${r.linhas.length}`, ...vazio.slice(1)],
    ],
    ...(identificacao ? { identificacao } : {}),
  };
}

const RELATORIOS = {
  salarios: { funcionalidade: FUNCIONALIDADE_SALARIOS, titulo: 'Salários', prefixo: 'salarios', obter: obterSalariosTp, planilha: planilhaSalarios },
  distribuicao: { funcionalidade: FUNCIONALIDADE_DISTRIBUICAO, titulo: 'Distribuição de pessoal', prefixo: 'distribuicao-pessoal', obter: obterDistribuicaoTp, planilha: planilhaDistribuicao },
} as const;
export type RelatorioPessoal = keyof typeof RELATORIOS;

/** Exporta um dos relatórios (rel.*:exportar) em XLSX, CSV ou PDF, com a EXPORTACAO no Histórico. */
export async function exportarPessoalTp(
  ctx: ContextoRequisicao,
  qual: RelatorioPessoal,
  bruto: unknown,
  formato: FormatoArquivo,
  porta: PortaPessoal,
  deps: { cliente?: PrismaClient } = {},
): Promise<Resultado<{ nome: string; tipo: string; bytes: Uint8Array }>> {
  const def = RELATORIOS[qual];
  exigir(ctx, def.funcionalidade, 'exportar');
  const tela = await def.obter(ctx, bruto, porta);
  if (!tela.relatorio) return falha([{ campo: '_', mensagem: tela.erro ?? MENSAGENS_PESSOAL.ESCOLHA_TP }]);
  const r = tela.relatorio;
  const t = tela.filtros;
  const filtros = [
    { rotulo: 'Termo de Parceria', valor: `${r.tp.numero} - ${r.tp.objeto}` },
    { rotulo: 'Período', valor: `${mesPorExtenso(t.de)} a ${mesPorExtenso(t.ate)}` },
    ...(t.cargo ? [{ rotulo: 'Cargo', valor: t.cargo }] : []),
    ...(t.meta ? [{ rotulo: 'Meta', valor: t.meta }] : []),
    ...(t.categoria ? [{ rotulo: 'Categoria', valor: ROTULO_CATEGORIA[t.categoria] }] : []),
    { rotulo: 'Origem', valor: MENSAGENS_PESSOAL.ORIGEM(r.versao) },
  ];
  const identificacao = criarIdentificacao({ titulo: `${def.titulo} (previsto na versão oficial) - ${r.tp.objeto}`, filtros, operador: ctx.usuarioRotulo });
  try {
    const bytes = await (deps.cliente ?? prisma).$transaction(async (tx) => {
      const p = def.planilha(r, identificacao);
      const g = await gerarArquivo(formato, [p]);
      if (!g.ok) throw new FalhaGeracao(g.erros);
      await auditar(tx, {
        contexto: { usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip, unidadeId: null },
        funcionalidade: def.funcionalidade,
        tipo: 'EXPORTACAO',
        registroId: r.tp.numero,
        descricao: `${def.titulo} do TP ${r.tp.numero} exportado em ${formato.toUpperCase()} (rastreio ${identificacao.rastreio})`,
        depois: { formato, registros: r.linhas.length, filtros, rastreio: identificacao.rastreio },
      });
      return g.valor;
    });
    return ok({ nome: nomeArquivoTp(def.prefixo, r.tp.numero, formato), tipo: TIPOS_ARQUIVO[formato], bytes });
  } catch (e) {
    if (e instanceof FalhaGeracao) return falha(e.erros);
    throw e;
  }
}

/** Quem vê o custo do pessoal: a mesma regra do orc (D-P20-5; `vePessoal`, que não é exportado). */
const veCustoPessoal = (ctx: ContextoRequisicao) => ctx.permissoes.has('orc.empregados:incluir') || ctx.permissoes.has('orc.empregados:alterar');

/** A porta real (orc, #544): os TPs e os empregados da versão oficializada, com a permissão e a RLS do orc. */
export const PORTA_PESSOAL: PortaPessoal = {
  tps: (ctx) => tpsDoRealizado(ctx),
  pessoal: async (ctx, f) => {
    const e = await empregadosDaVersaoOficial(ctx, f);
    if (!e) return null;
    return { versao: e.versao, porMeta: e.categoriaTp === 'META', veCusto: veCustoPessoal(ctx), homologado: e.lote === 'HOMOLOGADO' || e.empregados.length === 0, empregados: e.empregados };
  },
};
