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

// Minhas exportações (US-024): os pedidos em segundo plano da própria pessoa e o download.
export { baixarExportacao, DIAS_DISPONIVEL, listarMinhasExportacoes, type ArquivoPedido, type PedidoTela, type SituacaoPedido } from './application/minhas-exportacoes';

// Manual do usuário e roteiro de treinamento por perfil (US-118), montados do catálogo.
export { obterManual, type TelaManual } from './application/manual';
export { listarAcoes, type FuncionalidadeManual, type ModuloManual, type PassoTreinamento } from './domain/manual';
