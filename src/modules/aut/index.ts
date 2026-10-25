// API pública do módulo aut (spec §4.1).
export { autenticar, type DepsAut, type MotivoNegacao, type ResultadoLogin } from './application/autenticar';
export { criarLimitadorLogin, type LimitadorLogin } from './application/limite-login';
export { criarProvedorContexto, PERMISSOES_BASICAS, PERMISSOES_TROCA_OBRIGATORIA } from './application/provedor-contexto';
export { registrarAutenticacao } from './application/registrar';
export { avaliarAntesDaSenha, avaliarFalha } from './domain/autenticacao';
export { MENSAGENS } from './domain/mensagens';
export { gerarSessaoUid } from './domain/sessao';
export { COOKIE_UNIDADE, nomeCookieSessao } from './infrastructure/cookies';
export { entrar } from './application/acoes-login';
export { FormLogin } from './ui/form-login';
export { responderSair, sair } from './application/sair';
export { BotaoSair } from './ui/botao-sair';
export { trocar } from './application/acoes-senha';
export { trocarSenha, type EntradaTroca } from './application/trocar-senha';
export { FormTrocaSenha } from './ui/form-troca-senha';
