import { criarIdentificacao, TIPOS_ARQUIVO, type PlanilhaExportacao } from '@/modules/ger';
import { gerarArquivo } from '@/modules/ger/servidor';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { falha, ok, type Resultado } from '@/shared/kernel';
import { contextoAuditoria } from './calculo-linhas';
import { resolverDeps, type DepsOrc } from './deps';
import { mesOxr, type CelulaOxr, type TotalOxr } from './grade-oxr';
import { FUNCIONALIDADE_OXR, obterOrcadoRealizado, type FiltrosOxr, type TelaOxr } from './orcado-realizado';

// Exportação do Orçado x Realizado (US-086, parte 2; OxR V2, passo 7, REQ_OXR_006 e RN0232): os mesmos valores da
// tela, em XLSX ou PDF, com os filtros e o rastreio no cabeçalho (C3) e a EXPORTACAO no Histórico. O PDF é A4 paisagem:
// até 6 meses por arquivo [PROVISÓRIO, D-P33-4]; o XLSX leva o período da tela (até 24 meses).

export const FORMATOS_OXR = ['xlsx', 'pdf'] as const;
export type FormatoOxr = (typeof FORMATOS_OXR)[number];
export const MESES_MAXIMOS_PDF_OXR = 6;
export const MENSAGEM_PDF_LONGO = `Para o PDF, escolha um período de até ${MESES_MAXIMOS_PDF_OXR} meses; o XLSX aceita o período inteiro da tela.`;

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
  const r = await obterOrcadoRealizado(ctx, filtros, deps, { registrarConsulta: false });
  if (!r.tela) return falha([{ campo: '_', mensagem: r.erro ?? 'Selecione um Termo de Parceria para consultar.' }]);
  const t = r.tela;
  if (formato === 'pdf' && t.meses.length > MESES_MAXIMOS_PDF_OXR) return falha([{ campo: 'de', mensagem: MENSAGEM_PDF_LONGO }]);
  const descricaoFiltros = [
    { rotulo: 'Termo de Parceria', valor: `${t.numero} - ${t.objeto} (versão oficial ${t.versaoOficial})` },
    { rotulo: 'Período', valor: `${mesOxr(t.filtros.de)} a ${mesOxr(t.filtros.ate)}` },
    { rotulo: 'Conta', valor: t.filtros.conta || 'Todas' },
    { rotulo: 'Exibir contas zeradas', valor: t.filtros.zeradas ? 'Sim' : 'Não' },
    ...(t.semPessoal ? [{ rotulo: 'Contas de pessoal', valor: 'ocultas para o perfil' }] : []),
  ];
  const identificacao = criarIdentificacao({ titulo: `Orçado x Realizado - ${t.numero}`, filtros: descricaoFiltros, operador: ctx.usuarioRotulo }, deps.agora());
  const planilha = planilhaOxr(t, identificacao);
  const arquivo = await gerarArquivo(formato, [planilha]);
  if (!arquivo.ok) return arquivo;
  await deps.cliente.$transaction((tx) =>
    auditar(tx, {
      contexto: contextoAuditoria(ctx),
      funcionalidade: FUNCIONALIDADE_OXR,
      tipo: 'EXPORTACAO',
      registroId: t.propostaId,
      descricao: `Orçado x Realizado do TP ${t.numero} exportado em ${formato.toUpperCase()} (rastreio ${identificacao.rastreio})`,
      depois: { formato, linhas: planilha.linhas.length, filtros: descricaoFiltros, rastreio: identificacao.rastreio },
    }),
  );
  return ok({ nome: `orcado-realizado-${t.numero.replace(/[^\w-]+/g, '_')}-${t.filtros.de}-a-${t.filtros.ate}.${formato}`, tipo: TIPOS_ARQUIVO[formato], bytes: arquivo.valor });
}
