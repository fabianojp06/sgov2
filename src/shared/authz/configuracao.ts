// Pontos de configuração da guarda, fora da API pública (@/shared/authz): só o módulo aut
// (provedor de contexto, P5) e os testes devem importar daqui.
export { configurarAuditorNegacao, configurarProvedorContexto, type AuditorNegacao } from './contexto';
