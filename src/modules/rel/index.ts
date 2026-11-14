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

// Ajuda "como faço..." com base no manual (US-108): a ação, a liberação do campo e o componente.
export { perguntarAoManualAcao } from './application/acoes-ajuda-manual';
export { ajudaManualLiberada } from './application/ajuda-manual';
export { AjudaManualIA } from './ui/ajuda-manual';

// Análise do quadro de pessoal (US-107): os agregados, a ação da IA, a liberação do botão e os componentes.
export {
  analiseQuadroLiberada,
  lerFiltrosQuadro,
  MENSAGENS_QUADRO,
  obterQuadroAdmCentral,
  obterQuadroPessoal,
  PERMISSAO_EMPREGADOS,
} from './application/quadro-pessoal';
export { analisarQuadroPessoalAcao } from './application/acoes-quadro-pessoal';
export { AnaliseQuadroIA } from './ui/quadro-pessoal';
export { TabelaAdmCentral, TabelaQuadro } from './ui/quadro-pessoal-tabela';
