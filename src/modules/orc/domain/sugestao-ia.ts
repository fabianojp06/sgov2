import type { Prioridade } from './pacote';

// Ajuda da IA na justificativa do pacote base zero (US-063; plano do P14, D-P14-3). Tipos e rótulos
// que o servidor e a tela dividem: o painel do navegador não importa o application/.
export const FALTANDO_JUSTIFICATIVA = ['QUANTIDADE', 'MOTIVO', 'ALTERNATIVA'] as const;
export type FaltandoJustificativa = (typeof FALTANDO_JUSTIFICATIVA)[number];

export type SugestaoJustificativa = {
  texto: string;
  faltando: readonly FaltandoJustificativa[];
  prioridade: Prioridade;
  motivoPrioridade: string;
};

// [PROVISÓRIOS]
export const ROTULO_FALTANDO: Readonly<Record<FaltandoJustificativa, string>> = {
  QUANTIDADE: 'Quantidade: diga quanto e de quê.',
  MOTIVO: 'Motivo: diga por que o gasto é necessário.',
  ALTERNATIVA: 'Alternativa: diga o que acontece sem o gasto ou que outra opção foi vista.',
};

export const ROTULO_PRIORIDADE: Readonly<Record<Prioridade, string>> = { ESSENCIAL: 'Essencial', IMPORTANTE: 'Importante', DESEJAVEL: 'Desejável' };

// Sugestão de conta e CC pela descrição do gasto (US-062; plano do P14, D-P14-2): até 3 contas, da
// mais provável para a menos provável, e um CC (ou nenhum), todos já conferidos pelo servidor.
export type SugestaoContaCc = {
  contas: readonly { conta: string; descricao: string; motivo: string }[];
  cc: { cc: string; descricao: string; motivo: string } | null;
};

// Sugestões aceitas no formulário (D-P14-3): o que a pessoa pôs com "Usar …".
export type SugestoesAceitas = { justificativa?: string | undefined; prioridade?: string | undefined; conta?: string | undefined; cc?: string | undefined };
export type ValoresMarcaveis = { justificativa: string; prioridade: string; conta: string; cc: string };
const normalizar = (t: string) => t.replace(/\r\n?/g, '\n').trim();

/**
 * A marca sugestaoIa vai junto enquanto algum campo (justificativa, prioridade, conta ou CC) continua
 * com o valor aceito. A comparação da justificativa ignora o fim de linha (CRLF ou LF) e os espaços
 * nas pontas; a da prioridade, da conta e do CC é exata.
 */
export function deveMarcarSugestao(aceitas: SugestoesAceitas, valores: ValoresMarcaveis): boolean {
  const texto = aceitas.justificativa !== undefined && normalizar(valores.justificativa) === normalizar(aceitas.justificativa);
  const igual = (k: 'prioridade' | 'conta' | 'cc') => aceitas[k] !== undefined && valores[k] === aceitas[k];
  return texto || igual('prioridade') || igual('conta') || igual('cc');
}

/**
 * "Usar esta conta" ou "Usar este CC" (D-P14-3): o que o seletor passa a ter e o que fica aceito.
 * Valor fora das opções do seletor: null, e nada muda. Valor que já era o escolhido: nada veio da IA,
 * e as aceitas não mudam (a entrada não leva a marca por isso).
 */
export function usarSugestaoNoSeletor(
  aceitas: SugestoesAceitas,
  campo: 'conta' | 'cc',
  valor: string,
  seletor: { opcoes: readonly string[]; atual: string },
): { valor: string; aceitas: SugestoesAceitas } | null {
  if (!seletor.opcoes.includes(valor)) return null;
  if (seletor.atual === valor) return { valor, aceitas };
  return { valor, aceitas: { ...aceitas, [campo]: valor } };
}
