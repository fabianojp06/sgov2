// API pública do módulo aut (spec §4.1).
export { autenticar, type DepsAut, type MotivoNegacao, type ResultadoLogin } from './application/autenticar';
export { avaliarAntesDaSenha, avaliarFalha } from './domain/autenticacao';
export { gerarSessaoUid } from './domain/sessao';
