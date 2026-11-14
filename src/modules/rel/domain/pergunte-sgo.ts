import { falha, ok, type Resultado } from '@/shared/kernel';
import { contarCaracteres, MAXIMO_PERGUNTA, MINIMO_PERGUNTA, semMarcas } from './ajuda-manual';

// Pergunte ao SGO (US-104, IA-16), parte 1: a pergunta em linguagem comum vira UMA consulta de um catálogo
// fixo de ferramentas somente leitura (a IA só classifica e extrai os parâmetros); o SISTEMA executa a
// consulta com as permissões e a unidade de quem pergunta e monta a resposta com o número, a fonte e o link.
// Nenhum número sai da IA. Parte 2: o realizado e o saldo (previsto − realizado) de um TP, pelos demonstrativos
// da US-096 (UC05.02 e UC05.01).

export const CONSULTAS = [
  'ORCAMENTO_ADM_CENTRAL',
  'PESSOAL_ADM_CENTRAL',
  'TETO_ADM_CENTRAL',
  'SALDO_ADM_CENTRAL',
  'RESULTADO_ADM_CENTRAL',
  'ORCADO_CC',
  'VALOR_GLOBAL_TP',
  'QUANTIDADE_TPS',
  'REALIZADO_TP',
  'SALDO_TP',
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
  REALIZADO_TP: 'despesa realizada (gasto, executado) de um Termo de Parceria pelo número, no ano dito ou em toda a vigência (tp e ano)',
  SALDO_TP: 'saldo entre o previsto e o realizado de um Termo de Parceria pelo número, no ano dito ou em toda a vigência (tp e ano)',
  NAO_SEI: 'nenhuma das anteriores responde à pergunta',
};

export type Classificacao = { consulta: Consulta; ano: number | null; cc: string | null; tp: string | null };

// A classificação do CC (até 8 níveis, como o cadastro aceita).
const CC = /^\d{1,4}(\.\d{1,4}){0,7}$/;

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
 * Normaliza a classificação da IA: consulta fora do catálogo vira NAO_SEI; ano nulo fica nulo (o exercício que
 * a tela abre) e o ano dito é mantido como está (sem exercício, a resposta diz isso, nunca troca o ano); cc e
 * tp só no formato esperado (senão, NAO_SEI quando a consulta precisa deles).
 */
export function conferirClassificacao(v: { consulta: string; ano: number | null; cc: string | null; tp: string | null }): Classificacao {
  const consulta = (CONSULTAS as readonly string[]).includes(v.consulta) ? (v.consulta as Consulta) : 'NAO_SEI';
  const ano = v.ano !== null && Number.isInteger(v.ano) ? v.ano : null;
  const cc = v.cc !== null && CC.test(v.cc.trim()) ? v.cc.trim() : null;
  const tp = v.tp !== null && v.tp.trim().length > 0 && v.tp.trim().length <= 40 ? v.tp.trim() : null;
  const precisaTp = consulta === 'VALOR_GLOBAL_TP' || consulta === 'REALIZADO_TP' || consulta === 'SALDO_TP';
  if ((consulta === 'ORCADO_CC' && cc === null) || (precisaTp && tp === null)) return { consulta: 'NAO_SEI', ano, cc: null, tp: null };
  return { consulta, ano, cc, tp };
}

// Normaliza para comparar: maiúsculas, sem espaço nem hífen, e cada número sem zeros à esquerda.
const normalizarTp = (t: string) =>
  t
    .toLocaleUpperCase('pt-BR')
    .replace(/[\s-]/g, '')
    .replace(/\d+/g, (n) => String(Number(n)));
/** O número do TP sem diferença de escrita: "tp 03" acha "TP-3"; só o número ("3") acha "TP-3". */
export const mesmoTp = (a: string, b: string) => {
  const [x, y] = [normalizarTp(a), normalizarTp(b)];
  return x === y || (/^\d+$/.test(y) && x === `TP${y}`) || (/^\d+$/.test(x) && y === `TP${x}`);
};
/** A classificação do CC sem zeros à esquerda por segmento: "4.1.1.1.1" acha "4.1.1.1.001". */
export const mesmoCc = (a: string, b: string) => a.split('.').map(Number).join('.') === b.split('.').map(Number).join('.');

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
