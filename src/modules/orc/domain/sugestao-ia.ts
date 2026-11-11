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
