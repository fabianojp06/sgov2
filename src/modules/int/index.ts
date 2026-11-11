// API pública do módulo int (spec §4.1): integrações externas. Por ora, o cadastro da IA (US-019).
// Código só de servidor sem guarda (seed) sai pelo servidor.ts.
export { acaoAlterarCasoUsoIA, acaoAlterarConfiguracaoIA } from './application/acoes-ia';
export { obterTelaIA, type CasoUsoTela, type TelaIA } from './application/ia';
export { CadastroIA } from './ui/cadastro-ia';
