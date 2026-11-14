import { criarIdentificacao, TIPOS_ARQUIVO, type PlanilhaExportacao } from '@/modules/ger';
import { gerarArquivo } from '@/modules/ger/servidor';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { falha, ok, type Resultado } from '@/shared/kernel';
import { contextoAuditoria } from './calculo-linhas';
import { resolverDeps, type DepsOrc } from './deps';
import { mesOxr, type CelulaOxr, type TotalOxr } from './grade-oxr';
import { valorParaTela } from '../domain/valor-tela';
import { FUNCIONALIDADE_OXR, montarOrcadoRealizado, type FiltrosOxr, type TelaOxr } from './orcado-realizado';

// Exportação do Orçado x Realizado (US-086, parte 2; OxR V2, passo 7, REQ_OXR_006 e RN0232): os mesmos valores da
// tela, em XLSX ou PDF, com os filtros e o rastreio no cabeçalho (C3) e a EXPORTACAO no Histórico. O PDF é A4 paisagem:
// até 6 meses por arquivo [PROVISÓRIO, D-P33-4]; o XLSX leva o período da tela (até 24 meses).

export const FORMATOS_OXR = ['xlsx', 'pdf'] as const;
export type FormatoOxr = (typeof FORMATOS_OXR)[number];
export const MESES_MAXIMOS_PDF_OXR = 6;
export const MENSAGEM_PDF_LONGO = `Para o PDF, escolha um período de até ${MESES_MAXIMOS_PDF_OXR} meses; o XLSX aceita o período inteiro da tela.`;

// O C3 limita o valor do filtro a 200 caracteres (o objeto do TP vai até 500) e o nome do arquivo a letras, dígitos,
// ponto e hífen (revisão 12.12).
const cortar = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);
const NOME_ARQUIVO = /^[a-z0-9.-]+$/i;
const paraNome = (t: string) => t.replace(/[^A-Za-z0-9-]+/g, '-');
const dataHora = (d: Date) => d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

const uso = (c: CelulaOxr): string => (c.semOrcamento ? 'Sem orçamento' : c.uso ? c.uso.formatar() : '—');
const celulas = (c: CelulaOxr) => [c.orcado.paraString(), c.realizado.paraString(), uso(c)];
const periodo = (t: TotalOxr) => [t.orcado.paraString(), t.realizado.paraString(), t.saldo.paraString(), uso(t)];

/** A grade da tela como uma aba (a mesma ordem de colunas da seção 5.1). */
export function planilhaOxr(t: TelaOxr, identificacao?: PlanilhaExportacao['identificacao']): PlanilhaExportacao {
  const porMes = t.meses.flatMap((m) => [
    { titulo: `Orçado ${mesOxr(m)}`, tipo: 'dinheiro' as const },
    { titulo: `Realizado ${mesOxr(m)}`, tipo: 'dinheiro' as const },
    { titulo: `% uso ${mesOxr(m)}`, tipo: 'texto' as const },
  ]);
  return {
    nome: 'Orçado x Realizado',
    colunas: [
      { titulo: 'Conta', tipo: 'texto' },
      { titulo: 'Descrição', tipo: 'texto' },
      ...porMes,
      { titulo: 'Orçado período', tipo: 'dinheiro' },
      { titulo: 'Realizado período', tipo: 'dinheiro' },
      { titulo: 'Saldo período', tipo: 'dinheiro' },
      { titulo: '% uso período', tipo: 'texto' },
    ],
    linhas: [
      ...t.grade.linhas.map((l) => [l.conta, `${l.descricao}${l.inativa ? ' (inativa)' : ''}`, ...l.meses.flatMap(celulas), ...periodo(l.periodo)]),
      [t.filtros.conta ? `Total da conta ${t.filtros.conta}` : 'Total período', '', ...t.grade.total.meses.flatMap(celulas), ...periodo(t.grade.total.periodo)],
      // Como a nota da tela: valores em conta fora do plano não entram no total (REQ_OXR_006, mesmos valores da tela).
      ...t.grade.foraDoPlano.map((f) => [
        f.conta,
        'Fora do plano de contas (não entra no total)',
        ...t.meses.flatMap(() => [null, null, '']),
        f.orcado.paraString(),
        f.realizado.paraString(),
        null,
        '',
      ]),
    ],
    ...(identificacao ? { identificacao } : {}),
  };
}

export async function exportarOrcadoRealizado(
  ctx: ContextoRequisicao,
  filtros: FiltrosOxr,
  formato: FormatoOxr,
  depsParciais: Partial<DepsOrc> = {},
): Promise<Resultado<{ nome: string; tipo: string; bytes: Uint8Array }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE_OXR, 'exportar');
  const r = await montarOrcadoRealizado(ctx, filtros, deps, false);
  if (!r.tela) return falha([{ campo: '_', mensagem: r.erro ?? 'Selecione um Termo de Parceria para consultar.' }]);
  const t = r.tela;
  if (formato === 'pdf' && t.meses.length > MESES_MAXIMOS_PDF_OXR) return falha([{ campo: 'de', mensagem: MENSAGEM_PDF_LONGO }]);
  const descricaoFiltros = [
    { rotulo: 'Termo de Parceria', valor: cortar(`${t.numero} - ${t.objeto}`, 170) },
    { rotulo: 'Versão oficial', valor: String(t.versaoOficial) },
    { rotulo: 'Período', valor: `${mesOxr(t.filtros.de)} a ${mesOxr(t.filtros.ate)}` },
    { rotulo: 'Conta', valor: t.filtros.conta || 'Todas' },
    { rotulo: 'Exibir contas zeradas', valor: t.filtros.zeradas ? 'Sim' : 'Não' },
    ...(t.semPessoal ? [{ rotulo: 'Contas de pessoal', valor: 'ocultas para o perfil' }] : []),
    ...(t.pessoalNaoHomologado ? [{ rotulo: 'Pessoal', valor: 'não homologado, fora do orçado' }] : []),
    { rotulo: 'Última atualização do Realizado', valor: t.atualizadoEm ? dataHora(t.atualizadoEm) : 'não carregado' },
    ...(t.pendencias.quantidade > 0
      ? [{ rotulo: 'Pendências do ERP sem conta no SGO', valor: `${t.pendencias.quantidade} (R$ ${valorParaTela(t.pendencias.valor)})` }]
      : []),
  ];
  const identificacao = criarIdentificacao({ titulo: `Orçado x Realizado - ${t.numero}`, filtros: descricaoFiltros, operador: ctx.usuarioRotulo }, deps.agora());
  const planilha = planilhaOxr(t, identificacao);
  const nome = `orcado-realizado-${paraNome(t.numero)}-${t.filtros.de}-a-${t.filtros.ate}.${formato}`;
  if (!NOME_ARQUIVO.test(nome)) return falha([{ campo: '_', mensagem: 'Não foi possível montar o nome do arquivo.' }]);
  const arquivo = await gerarArquivo(formato, [planilha]);
  if (!arquivo.ok) return arquivo;
  await deps.cliente.$transaction((tx) =>
    auditar(tx, {
      contexto: { ...contextoAuditoria(ctx), unidadeId: t.unidadeId },
      funcionalidade: FUNCIONALIDADE_OXR,
      tipo: 'EXPORTACAO',
      registroId: t.propostaId,
      descricao: `Orçado x Realizado do TP ${t.numero} exportado em ${formato.toUpperCase()} (rastreio ${identificacao.rastreio})`,
      depois: { formato, linhas: planilha.linhas.length, filtros: descricaoFiltros, rastreio: identificacao.rastreio },
    }),
  );
  return ok({ nome, tipo: TIPOS_ARQUIVO[formato], bytes: arquivo.valor });
}
