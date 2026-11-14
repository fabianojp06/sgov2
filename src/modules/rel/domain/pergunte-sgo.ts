import { falha, ok, type Resultado } from '@/shared/kernel';
import { contarCaracteres, MAXIMO_PERGUNTA, MINIMO_PERGUNTA, semMarcas } from './ajuda-manual';

// Pergunte ao SGO (US-104, IA-16), parte 1: a pergunta em linguagem comum vira UMA consulta de um catálogo
// fixo de ferramentas somente leitura (a IA só classifica e extrai os parâmetros); o SISTEMA executa a
// consulta com as permissões e a unidade de quem pergunta e monta a resposta com o número, a fonte e o link.
// Nenhum número sai da IA. O catálogo cresce com os relatórios (US-096 em diante, depois do realizado).

export const CONSULTAS = [
  'ORCAMENTO_ADM_CENTRAL',
  'PESSOAL_ADM_CENTRAL',
  'TETO_ADM_CENTRAL',
  'SALDO_ADM_CENTRAL',
  'RESULTADO_ADM_CENTRAL',
  'ORCADO_CC',
  'VALOR_GLOBAL_TP',
  'QUANTIDADE_TPS',
  'NAO_SEI',
] as const;
export type Consulta = (typeof CONSULTAS)[number];

/** O que a IA pode escolher, com a descrição que vai na instrução (o modelo só vê isto, nunca os dados). */
export const DESCRICAO_CONSULTA: Readonly<Record<Consulta, string>> = {
  ORCAMENTO_ADM_CENTRAL: 'orçamento total da Administração Central no exercício (ano)',
  PESSOAL_ADM_CENTRAL: 'custo de pessoal orçado da Administração Central no exercício (ano)',
  TETO_ADM_CENTRAL: 'teto do orçamento da Administração Central no exercício (ano)',
  SALDO_ADM_CENTRAL: 'saldo entre o teto e o orçado da Administração Central no exercício (ano)',
  RESULTADO_ADM_CENTRAL: 'resultado do ano (receita menos despesa) da Administração Central (ano)',
  ORCADO_CC: 'orçado de um centro de custo da Administração Central pela classificação, como 4.3.2 (ano e cc)',
  VALOR_GLOBAL_TP: 'Valor Global de um Termo de Parceria pelo número (tp)',
  QUANTIDADE_TPS: 'quantos Termos de Parceria existem no consolidado',
  NAO_SEI: 'nenhuma das anteriores responde à pergunta',
};

export type Classificacao = { consulta: Consulta; ano: number | null; cc: string | null; tp: string | null };

const CC = /^\d{1,3}(\.\d{1,3}){0,5}$/;

/** A pergunta: o texto bruto tem teto antes do semMarcas; depois, as marcas saem e o tamanho é conferido. */
export function validarPergunta(bruto: unknown): Resultado<string> {
  if (typeof bruto === 'string' && bruto.length > MAXIMO_PERGUNTA * 4) return falha([{ campo: 'pergunta', mensagem: `A pergunta tem mais de ${MAXIMO_PERGUNTA} caracteres.` }]);
  const p = semMarcas(typeof bruto === 'string' ? bruto : '')
    .replace(/[\s\p{Cc}]+/gu, ' ')
    .trim();
  if (contarCaracteres(p) < MINIMO_PERGUNTA) return falha([{ campo: 'pergunta', mensagem: `Escreva a pergunta com pelo menos ${MINIMO_PERGUNTA} caracteres.` }]);
  if (contarCaracteres(p) > MAXIMO_PERGUNTA) return falha([{ campo: 'pergunta', mensagem: `A pergunta tem mais de ${MAXIMO_PERGUNTA} caracteres.` }]);
  return ok(p);
}

/**
 * Normaliza a classificação da IA: consulta fora do catálogo vira NAO_SEI; ano fora de 2000..2100 vira o ano
 * atual; cc e tp só no formato esperado (senão, NAO_SEI quando a consulta precisa deles).
 */
export function conferirClassificacao(v: { consulta: string; ano: number | null; cc: string | null; tp: string | null }, anoAtual: number): Classificacao {
  const consulta = (CONSULTAS as readonly string[]).includes(v.consulta) ? (v.consulta as Consulta) : 'NAO_SEI';
  const ano = v.ano !== null && Number.isInteger(v.ano) && v.ano >= 2000 && v.ano <= 2100 ? v.ano : anoAtual;
  const cc = v.cc !== null && CC.test(v.cc.trim()) ? v.cc.trim() : null;
  const tp = v.tp !== null && v.tp.trim().length > 0 && v.tp.trim().length <= 40 ? v.tp.trim() : null;
  if ((consulta === 'ORCADO_CC' && cc === null) || (consulta === 'VALOR_GLOBAL_TP' && tp === null)) return { consulta: 'NAO_SEI', ano, cc: null, tp: null };
  return { consulta, ano, cc, tp };
}

/** Compara o número do TP sem diferença de maiúsculas e de espaços (o usuário escreve "tp-001/2027" ou "TP 001/2027"). */
export const mesmoTp = (a: string, b: string) => a.replace(/[\s-]/g, '').toLocaleUpperCase('pt-BR') === b.replace(/[\s-]/g, '').toLocaleUpperCase('pt-BR');

/** A mensagem para a IA: só a pergunta entre marcas e o catálogo (nenhum dado do sistema vai ao modelo). */
export function mensagemPergunta(pergunta: string, anoAtual: number): string {
  return [
    `Ano atual: ${anoAtual}.`,
    'Consultas disponíveis (use só um destes códigos):',
    ...CONSULTAS.map((c) => `- ${c}: ${DESCRICAO_CONSULTA[c]}`),
    `Pergunta: <<<${pergunta}>>>`,
  ].join('\n');
}

export type Resposta =
  | { tipo: 'NUMERO'; texto: string; valor: string; fonte: string; link: string }
  | { tipo: 'SEM_DADO'; texto: string; fonte: string | null; link: string | null }
  | { tipo: 'NAO_SEI'; texto: string };
