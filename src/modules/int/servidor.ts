// Entrada só de servidor do int (plano do P4, R22): seed e worker. Páginas e componentes usam o index.ts.
export { FUNCIONALIDADES_INT, seedInt } from './infrastructure/seed';
export { registrarSinalVida } from './infrastructure/sinal-vida';
export { registrarTrabalhadoresInt, type DepsAvaliacao } from './infrastructure/trabalhador-avaliacao';
