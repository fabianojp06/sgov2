// API pública do rel para as páginas (src/app/(sistema)/rel/). Seed: servidor.ts.

// Conferência da carga inicial (plano do P7, Task 2; US-115).
export {
  exportarConferenciaCarga,
  obterConferenciaCarga,
  type ArquivoExportado,
  type FormatoExportacao,
  type TelaConferencia,
} from './application/conferencia-carga';
export type { LinhaConferencia } from './application/linhas-conferencia';
