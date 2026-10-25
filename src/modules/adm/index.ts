// API pública do módulo adm (spec §4.1). Contrato C6: catálogo de funcionalidades e perfis padrão.
export { MODULOS_MENU, type CodigoModuloMenu, type DeclaracaoFuncionalidade } from './application/catalogo';
export { obterConfiguracaoAcesso, type ConfiguracaoAcesso } from './application/configuracao';
export { instalarFuncionalidades } from './application/instalar-funcionalidades';
export { normalizarLogin } from './domain/login';
export { CODIGOS_PERFIL, type CodigoPerfil } from './domain/perfis';
export { validarSenha, type PoliticaSenha } from './domain/politica-senha';
export { seedAdministradorInicial } from './infrastructure/admin-inicial';
export { gerarSenhaTemporaria } from './infrastructure/gerar-senha';
export { seedAdm } from './infrastructure/seed';
export { conferirSenha, hashSenha } from './infrastructure/senha-argon2';
