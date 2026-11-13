import { falha, ok, type ErroCampo, type Percentual, type Resultado } from '@/shared/kernel';
import { percentualDoTexto } from './parametros';

// Impostos e alíquotas com vigência (US-052; UC03.01, REQ_TAX_001, RN_TAX_01/05/06). A alíquota vale
// a partir da competência (mês) em que entra e até a próxima; nunca há alíquota fixa no código (RN_TAX_01).

export const INCIDENCIAS = ['CONTRATO', 'TERMO_PARCERIA', 'AMBOS'] as const;
export type Incidencia = (typeof INCIDENCIAS)[number];
export const ROTULO_INCIDENCIA: Readonly<Record<Incidencia, string>> = {
  CONTRATO: 'Contrato',
  TERMO_PARCERIA: 'Termo de Parceria',
  AMBOS: 'Ambos',
};
export const TAMANHO_NOME_IMPOSTO = 20;

/** Competência no formato AAAA-MM. */
export type AnoMes = `${number}-${number}`;
const COMPETENCIA = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const ehCompetencia = (t: string): t is AnoMes => COMPETENCIA.test(t);

export function validarImposto(e: { nome: string; incidencia: string }): Resultado<{ nome: string; incidencia: Incidencia }> {
  const erros: ErroCampo[] = [];
  const nome = e.nome.trim();
  if (nome.length === 0) erros.push({ campo: 'nome', mensagem: 'Informe o nome do imposto.' });
  else if (nome.length > TAMANHO_NOME_IMPOSTO) erros.push({ campo: 'nome', mensagem: `Use no máximo ${TAMANHO_NOME_IMPOSTO} caracteres.` });
  if (!(INCIDENCIAS as readonly string[]).includes(e.incidencia)) erros.push({ campo: 'incidencia', mensagem: 'Escolha o tipo de incidência.' });
  return erros.length > 0 ? falha(erros) : ok({ nome, incidencia: e.incidencia as Incidencia });
}

/**
 * A alíquota nova: percentual de 0 a 100 (com vírgula ou ponto, até 4 casas) e competência atual ou
 * futura (RN_TAX_05, E4: sem retroatividade). `mesAtual` vem do servidor (AAAA-MM, fuso de Brasília).
 */
export function validarAliquota(e: { competencia: string; percentual: string }, mesAtual: AnoMes): Resultado<{ competencia: AnoMes; percentual: Percentual }> {
  const erros: ErroCampo[] = [];
  const competencia = e.competencia.trim();
  if (!ehCompetencia(competencia)) erros.push({ campo: 'competencia', mensagem: 'Informe a competência no formato AAAA-MM.' });
  else if (competencia < mesAtual) erros.push({ campo: 'competencia', mensagem: 'A vigência de uma alíquota não pode ser retroativa.' });
  const p = percentualDoTexto(e.percentual);
  if (p === null) erros.push({ campo: 'percentual', mensagem: 'Informe a alíquota com até 4 casas decimais.' });
  else if (p.comoFracao().lt(0) || p.comoFracao().gt(1)) erros.push({ campo: 'percentual', mensagem: 'A alíquota deve ficar entre 0 e 100%.' });
  return erros.length > 0 ? falha(erros) : ok({ competencia: competencia as AnoMes, percentual: p! });
}

/** A alíquota que vale na competência: a de maior competência até ela; null se nenhuma começou. */
export function aliquotaVigente<T extends { competencia: AnoMes }>(aliquotas: readonly T[], competencia: AnoMes): T | null {
  let vigente: T | null = null;
  for (const a of aliquotas) if (a.competencia <= competencia && (vigente === null || a.competencia > vigente.competencia)) vigente = a;
  return vigente;
}

/** O imposto incide no tipo de proposta? (AMBOS incide nos dois.) */
export const incideEm = (incidencia: Incidencia, tipo: 'CONTRATO' | 'TERMO_PARCERIA') => incidencia === 'AMBOS' || incidencia === tipo;

/** AAAA-MM do instante no fuso de Brasília (o mesmo do trigger da migration). */
export function competenciaDe(instante: Date): AnoMes {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(instante);
  const ano = partes.find((p) => p.type === 'year')!.value;
  const mes = partes.find((p) => p.type === 'month')!.value;
  return `${ano}-${mes}` as AnoMes;
}

