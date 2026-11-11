// Entrada só de servidor do adm (plano do P4, R22): worker, seed e casos de uso de outros módulos.
// Páginas e componentes usam o index.ts (o lint proíbe app/ e ui/ de importar este arquivo).
// Nada aqui importa @/shared/authz nem next/ (o worker/bundle.test.ts reprova): os casos de uso
// de usuário, que exigem permissão, ficam só no index.ts.
export { type DeclaracaoFuncionalidade } from './application/catalogo';
export { instalarFuncionalidades } from './application/instalar-funcionalidades';
// Contagem de usuários por perfil para a conferência da carga do rel (#137); sem permissão própria.
export { contarUsuariosPorPerfil, type ContagemUsuarios } from './application/contagem-usuarios';
// Roteamento das alçadas (US-042) para os fluxos de aprovação (US-078); sem permissão própria.
export { resolverAprovador, type AprovadorResolvido } from './application/roteamento-alcada';
export { MENSAGENS_ALCADA, type FluxoAprovacao } from './domain/alcada';
// Exportação assíncrona do Histórico (US-040, US-024): o gerador que o worker passa ao ger. Sem
// sessão no worker, ele refaz a permissão e o alcance de quem pediu.
export { GERADORES_EXPORTACAO_ADM } from './application/planilha-historico';
// Revisor do orçamento (US-064; plano do P14, D-P14-6): o worker remonta quem pediu, sem sessão, com
// as mesmas leituras do provedor de contexto (usuário ativo e sem bloqueio, sistema ativo, permissões
// do perfil) e o CC de escopo.
export { carregarPermissoes, obterUsuarioParaSessao } from './application/login';
export { manutencaoEfetiva, obterConfiguracaoAcesso } from './application/configuracao';
export { obterEscopoCentroCusto } from './application/escopo-cc';
