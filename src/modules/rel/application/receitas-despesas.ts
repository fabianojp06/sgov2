import 'server-only';
import type { PrismaClient } from '@/generated/prisma/client';
import { listarArvoreContas } from '@/modules/cad';
import { criarIdentificacao, TIPOS_ARQUIVO, type FormatoArquivo, type PlanilhaExportacao } from '@/modules/ger';
import { gerarArquivo } from '@/modules/ger/servidor';
import type { TpDoRealizado } from '@/modules/orc';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma } from '@/shared/db';
import { Dinheiro, falha, ok, type Resultado } from '@/shared/kernel';
import { mesPorExtenso } from './despesas-tp-montagem';
import { FalhaGeracao, filtrosDoTp, MENSAGENS_DESPESAS, type PortaRealizado, type TelaDespesas } from './despesas-tp';
import { montarPrevistoRealizado, type PrevistoRealizado, type Prs } from './receitas-despesas-montagem';

// Demonstrativo de receitas e despesas sintético do TP (US-096 parte 2; UC05.01), 1ª e 2ª tabelas. Só leitura:
// o previsto (cronograma da versão oficializada) e o realizado vêm juntos da porta do orc (US-085, `previsto: true`),
// com a permissão e a RLS dela; as contas, do C1 com as inativas. Os filtros são os do demonstrativo de despesas
// (TP obrigatório, vigência inteira por padrão, só TP oficial, "exibir zerados"). A 3ª tabela fica para a US-088.

export const FUNCIONALIDADE_RECEITAS_DESPESAS = 'rel.receitas_despesas_tp';

export type TelaReceitasDespesas = {
  tps: readonly TpDoRealizado[];
  filtros: TelaDespesas['filtros'];
  relatorio:
    | (PrevistoRealizado & {
        tp: TpDoRealizado;
        atualizadoEm: Date | null;
        pendencias: { quantidade: number; valor: string };
        ajustes: number;
        /** O número da versão oficializada de onde vem o previsto; nulo se não há (o previsto sai zerado). */
        versaoPrevisto: number | null;
        /** O custo do pessoal homologado não entra no previsto deste perfil (D-P23-5). */
        previstoSemPessoal: boolean;
        /** O lote de pessoal da versão oficial não foi homologado: o pessoal não entra (RN_WA05_005). */
        pessoalNaoHomologado: boolean;
      })
    | null;
  erro: string | null;
};

export async function obterReceitasDespesasTp(
  ctx: ContextoRequisicao,
  bruto: unknown,
  porta: PortaRealizado,
  deps: { agora?: () => Date; contas?: typeof listarArvoreContas } = {},
): Promise<TelaReceitasDespesas> {
  exigir(ctx, FUNCIONALIDADE_RECEITAS_DESPESAS, 'consultar');
  const f = await filtrosDoTp(ctx, bruto, porta, (deps.agora ?? (() => new Date()))());
  if (!f.pronto) return { tps: f.tps, filtros: f.filtros, relatorio: null, erro: f.erro };
  const { tps, filtros, tp } = f;
  const [dados, arvore] = await Promise.all([
    // Desde o início do TP: o que vem antes do período entra só no saldo anterior (RN0391/0392).
    porta.realizado(ctx, { tp: tp.numero, de: tp.inicio, ate: filtros.ate, previsto: true }),
    (deps.contas ?? listarArvoreContas)(prisma, { incluirInativos: true }),
  ]);
  if (!dados) return { tps, filtros, relatorio: null, erro: MENSAGENS_DESPESAS.TP_INEXISTENTE };
  const d = montarPrevistoRealizado(arvore, dados.linhas, dados.previsto ?? [], filtros.de, filtros.ate, { exibirZerados: filtros.exibirZerados, anoAtual: f.anoAtual });
  return {
    tps,
    filtros,
    relatorio: {
      ...d,
      tp,
      atualizadoEm: dados.atualizadoEm,
      pendencias: { quantidade: dados.pendencias.quantidade, valor: dados.pendencias.valor.paraString() },
      ajustes: dados.ajustes.length,
      versaoPrevisto: dados.versaoPrevisto ?? null,
      previstoSemPessoal: dados.previstoSemPessoal ?? false,
      pessoalNaoHomologado: dados.pessoalNaoHomologado ?? false,
    },
    erro: null,
  };
}

/** Quantas colunas do período cabem numa página do PDF (cada uma com previsto, realizado e saldo). */
export const COLUNAS_POR_PAGINA_PDF = 3;
export const ROTULO_CRONOGRAMA = 'Cronograma de desembolso (previsto)';

/**
 * A planilha do demonstrativo: o cronograma de desembolso (1ª tabela) numa linha acima das contas e, por conta,
 * previsto, realizado e saldo de cada coluna. Com `bloco`, só aquelas colunas do período (o PDF divide a tabela
 * larga em páginas); o total por conta sai no último bloco.
 */
export function planilhaReceitasDespesas(
  r: NonNullable<TelaReceitasDespesas['relatorio']>,
  identificacao: PlanilhaExportacao['identificacao'],
  bloco?: { inicio: number; fim: number; nome: string },
): PlanilhaExportacao {
  const ini = bloco?.inicio ?? 0;
  const fim = bloco?.fim ?? r.colunas.length;
  const comTotal = fim >= r.colunas.length;
  const recuo = (n: number) => '  '.repeat(n);
  const tres = (v: Prs) => [v.previsto, v.realizado, v.saldo];
  const colunas = [...r.colunas.slice(ini, fim).map((c) => c.rotulo), ...(comTotal ? ['Total'] : [])];
  const cronograma = [...r.cronograma.valores.slice(ini, fim), ...(comTotal ? [r.cronograma.total] : [])];
  return {
    nome: bloco?.nome ?? 'Previsto x realizado',
    colunas: [
      { titulo: 'Conta', tipo: 'texto', largura: 90 },
      { titulo: 'Descrição', tipo: 'texto', largura: 220 },
      ...colunas.flatMap((c) => [`${c} Previsto`, `${c} Realizado`, `${c} Saldo`].map((titulo) => ({ titulo, tipo: 'dinheiro' as const }))),
    ],
    linhas: [
      ['', ROTULO_CRONOGRAMA, ...cronograma.flatMap((v) => [v, null, null])],
      ...r.linhas.map((l) => [
        l.classificacao,
        `${recuo(l.nivel)}${l.descricao}${l.inativa ? ' (inativa)' : ''}`,
        ...l.valores.slice(ini, fim).flatMap(tres),
        ...(comTotal ? tres(l.total) : []),
      ]),
      ['', 'Total Geral Termo de Parceria', ...r.totalGeral.valores.slice(ini, fim).flatMap(tres), ...(comTotal ? tres(r.totalGeral.total) : [])],
      // O que ficou fora (conta sintética ou fora das despesas) também sai no arquivo, com o valor no Total.
      ...(comTotal ? linhasFora(r, colunas.length) : []),
    ],
    ...(identificacao ? { identificacao } : {}),
  };
}

function linhasFora(r: NonNullable<TelaReceitasDespesas['relatorio']>, nColunas: number): (string | null)[][] {
  const vazio = Array.from({ length: (nColunas - 1) * 3 }, () => null);
  const { previsto, realizado } = r.foraDaArvore;
  return [
    ...(previsto.quantidade > 0 ? [['', `Fora do demonstrativo (previsto): ${previsto.quantidade} valor(es) em conta que não é analítica de despesa`, ...vazio, previsto.valor, null, null]] : []),
    ...(realizado.quantidade > 0 ? [['', `Fora do demonstrativo (realizado): ${realizado.quantidade} lançamento(s) em conta que não é analítica de despesa`, ...vazio, null, realizado.valor, null]] : []),
  ];
}

/** Os avisos da tela que mudam a leitura do número, também no cabeçalho do arquivo. */
export function avisosDoArquivo(r: NonNullable<TelaReceitasDespesas['relatorio']>): { rotulo: string; valor: string }[] {
  return [
    ...(Dinheiro.de(r.saldoAnterior).ehZero() ? [] : [{ rotulo: 'Saldo anterior ao período', valor: Dinheiro.de(r.saldoAnterior).formatar() }]),
    ...(r.previstoSemPessoal ? [{ rotulo: 'Pessoal', valor: 'O custo do pessoal homologado não entra no previsto deste perfil' }] : []),
    ...(r.pessoalNaoHomologado ? [{ rotulo: 'Pessoal', valor: 'Lote de pessoal não homologado: fora do previsto' }] : []),
    ...(r.pendencias.quantidade > 0 ? [{ rotulo: 'Pendências da carga', valor: `${r.pendencias.quantidade} lançamento(s), ${Dinheiro.de(r.pendencias.valor).formatar()}, fora do realizado` }] : []),
  ];
}

/** As planilhas do arquivo: uma só no XLSX e no CSV; no PDF, uma por grupo de colunas, para caber na página. */
export function planilhasDoFormato(r: NonNullable<TelaReceitasDespesas['relatorio']>, identificacao: PlanilhaExportacao['identificacao'], formato: FormatoArquivo) {
  if (formato !== 'pdf' || r.colunas.length <= COLUNAS_POR_PAGINA_PDF) return [planilhaReceitasDespesas(r, identificacao)];
  const n = Math.ceil(r.colunas.length / COLUNAS_POR_PAGINA_PDF);
  return Array.from({ length: n }, (_, i) =>
    planilhaReceitasDespesas(r, identificacao, {
      inicio: i * COLUNAS_POR_PAGINA_PDF,
      fim: (i + 1) * COLUNAS_POR_PAGINA_PDF,
      nome: `Previsto x realizado (${i + 1} de ${n})`,
    }),
  );
}

/** Exporta o demonstrativo (rel.receitas_despesas_tp:exportar) em XLSX, CSV ou PDF, com a EXPORTACAO no Histórico. */
export async function exportarReceitasDespesasTp(
  ctx: ContextoRequisicao,
  bruto: unknown,
  formato: FormatoArquivo,
  porta: PortaRealizado,
  deps: { agora?: () => Date; contas?: typeof listarArvoreContas; cliente?: PrismaClient } = {},
): Promise<Resultado<{ nome: string; tipo: string; bytes: Uint8Array }>> {
  exigir(ctx, FUNCIONALIDADE_RECEITAS_DESPESAS, 'exportar');
  const tela = await obterReceitasDespesasTp(ctx, bruto, porta, deps);
  if (!tela.relatorio) return falha([{ campo: '_', mensagem: tela.erro ?? MENSAGENS_DESPESAS.ESCOLHA_TP }]);
  const r = tela.relatorio;
  const filtros = [
    { rotulo: 'Termo de Parceria', valor: `${r.tp.numero} - ${r.tp.objeto}` },
    { rotulo: 'Período', valor: `${mesPorExtenso(tela.filtros.de)} a ${mesPorExtenso(tela.filtros.ate)}` },
    { rotulo: 'Previsto', valor: r.versaoPrevisto === null ? 'Sem versão oficializada' : `Versão ${r.versaoPrevisto}` },
    { rotulo: 'Exibir zerados', valor: tela.filtros.exibirZerados ? 'Sim' : 'Não' },
    ...avisosDoArquivo(r),
  ];
  const identificacao = criarIdentificacao({ titulo: `Demonstrativo de receitas e despesas - ${r.tp.objeto}`, filtros, operador: ctx.usuarioRotulo });
  try {
    const bytes = await (deps.cliente ?? prisma).$transaction(async (tx) => {
      const planilhas = planilhasDoFormato(r, identificacao, formato);
      const g = await gerarArquivo(formato, planilhas);
      if (!g.ok) throw new FalhaGeracao(g.erros);
      await auditar(tx, {
        contexto: { usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip, unidadeId: null },
        funcionalidade: FUNCIONALIDADE_RECEITAS_DESPESAS,
        tipo: 'EXPORTACAO',
        registroId: r.tp.numero,
        descricao: `Demonstrativo de receitas e despesas do TP ${r.tp.numero} exportado em ${formato.toUpperCase()} (rastreio ${identificacao.rastreio})`,
        depois: { formato, registros: r.linhas.length, filtros, rastreio: identificacao.rastreio },
      });
      return g.valor;
    });
    return ok({ nome: `receitas-despesas-${r.tp.numero.replace(/[^\w-]+/g, '_')}.${formato}`, tipo: TIPOS_ARQUIVO[formato], bytes });
  } catch (e) {
    if (e instanceof FalhaGeracao) return falha(e.erros);
    throw e;
  }
}
