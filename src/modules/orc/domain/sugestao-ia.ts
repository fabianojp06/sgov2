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

// Sugestões aceitas no formulário (D-P14-3): o que a pessoa pôs com "Usar …".
export type SugestoesAceitas = { justificativa?: string | undefined; prioridade?: string | undefined };
const normalizar = (t: string) => t.replace(/\r\n?/g, '\n').trim();

/**
 * A marca sugestaoIa vai junto enquanto algum campo continua com o valor aceito. A comparação da
 * justificativa ignora o fim de linha (CRLF ou LF) e os espaços nas pontas.
 */
export function deveMarcarSugestao(aceitas: SugestoesAceitas, valores: { justificativa: string; prioridade: string }): boolean {
  const texto = aceitas.justificativa !== undefined && normalizar(valores.justificativa) === normalizar(aceitas.justificativa);
  const prioridade = aceitas.prioridade !== undefined && valores.prioridade === aceitas.prioridade;
  return texto || prioridade;
}
