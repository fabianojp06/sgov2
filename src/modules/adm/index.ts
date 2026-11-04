// API pública do módulo adm (spec §4.1). Contrato C6: catálogo de funcionalidades e perfis padrão.
export { listarCatalogoDoMenu, listarUnidadesDoUsuario } from './application/catalogo-ativo';
export { MODULOS_MENU, type CodigoModuloMenu, type DeclaracaoFuncionalidade } from './application/catalogo';
export { obterConfiguracaoAcesso, type ConfiguracaoAcesso } from './application/configuracao';
export { obterEscopoCentroCusto } from './application/escopo-cc';
export { instalarFuncionalidades } from './application/instalar-funcionalidades';
export {
  carregarPermissoes,
  obterUsuarioParaSessao,
  registrarFalhaLogin,
  travarUsuarioParaLogin,
  travarUsuarioPorId,
  zerarFalhasLogin,
  type UsuarioParaLogin,
} from './application/login';
export { gravarNovaSenha } from './application/senhas';
export { alterar, cadastrar, desbloquear, gerarNovaSenha } from './application/acoes-usuarios';
export {
  consultarHistorico,
  FUNCIONALIDADE_HISTORICO,
  MENSAGEM_PERIODO,
  POR_PAGINA,
  type FiltroHistorico,
  type LinhaHistorico,
  type PaginaHistorico,
} from './application/historico';
export {
  alterarUsuario,
  cadastrarUsuario,
  desbloquearUsuario,
  listarOpcoesUsuario,
  listarUsuarios,
  obterUsuario,
  resetarSenha,
  type DepsAdm,
  type DetalheUsuario,
  type ItemListaUsuario,
  type OpcoesUsuario,
} from './application/usuarios';
export { normalizarLogin } from './domain/login';
export { CODIGOS_PERFIL, type CodigoPerfil } from './domain/perfis';
export { esquemaUsuario, MENSAGENS_USUARIO, type EntradaUsuario } from './domain/usuario';
export { validarSenha, type PoliticaSenha } from './domain/politica-senha';
export { FormUsuario } from './ui/form-usuario';
export { ListaUsuarios } from './ui/lista-usuarios';
export { seedAdministradorInicial } from './infrastructure/admin-inicial';
export { gerarSenhaTemporaria } from './infrastructure/gerar-senha';
export { seedAdm } from './infrastructure/seed';
export { conferirSenha, hashSenha } from './infrastructure/senha-argon2';
