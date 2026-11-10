// Entrada só de servidor do adm (plano do P4, R22): worker, seed e casos de uso de outros módulos.
// Páginas e componentes usam o index.ts (o lint proíbe app/ e ui/ de importar este arquivo).
// Nada aqui importa @/shared/authz nem next/ (o worker/bundle.test.ts reprova): os casos de uso
// de usuário, que exigem permissão, ficam só no index.ts.
export { type DeclaracaoFuncionalidade } from './application/catalogo';
export { instalarFuncionalidades } from './application/instalar-funcionalidades';
// Roteamento das alçadas (US-042) para os fluxos de aprovação (US-078); sem permissão própria.
export { resolverAprovador, type AprovadorResolvido } from './application/roteamento-alcada';
export { MENSAGENS_ALCADA, type FluxoAprovacao } from './domain/alcada';
