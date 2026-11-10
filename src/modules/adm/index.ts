// API pública do módulo adm (spec §4.1). Contrato C6: catálogo de funcionalidades e perfis padrão.
export { listarCatalogoDoMenu, listarUnidadesDoUsuario } from './application/catalogo-ativo';
export { MODULOS_MENU, type CodigoModuloMenu, type DeclaracaoFuncionalidade } from './application/catalogo';
export { manutencaoEfetiva, obterConfiguracaoAcesso, type ConfiguracaoAcesso } from './application/configuracao';
export { ativar, desativar } from './application/acoes-sistema';
export { TelaSistema } from './ui/tela-sistema';
export { ativarSistema, consultarEstadoSistema, desativarSistema, listarAtivacoes, obterEstadoSistema, travarDesativacaoEfetiva, type DepsSistema, type EstadoSistema, type LinhaAtivacao } from './application/sistema';
export { MENSAGENS_SISTEMA } from './domain/sistema';
export { obterEscopoCentroCusto } from './application/escopo-cc';
export { instalarFuncionalidades } from './application/instalar-funcionalidades';
export {
  carregarPermissoes,
  gravarRecuperacao,
  limparRecuperacao,
  obterUsuarioParaSessao,
  registrarFalhaLogin,
  travarUsuarioParaLogin,
  travarUsuarioPorId,
  zerarFalhasLogin,
  type UsuarioParaLogin,
} from './application/login';
export { gravarNovaSenha } from './application/senhas';
export { alterar, cadastrar, desbloquear, gerarNovaSenha } from './application/acoes-usuarios';
export { excluirAlcada, incluirAlcada, trocarAprovadores } from './application/acoes-alcadas';
export {
  alterarAlcada,
  cadastrarAlcada,
  inativarAlcada,
  listarAlcadas,
  listarAprovadoresPossiveis,
  obterAlcada,
  type DepsAlcadas,
  type LinhaAlcada,
} from './application/alcadas';
export { FormAlcada } from './ui/form-alcada';
export { ListaAlcadas } from './ui/lista-alcadas';
export { FLUXOS_APROVACAO, MENSAGENS_ALCADA, ROTULO_FLUXO, type FluxoAprovacao } from './domain/alcada';
export { registrarImpressaoHistorico } from './application/acoes-historico';
export { consultaDaUrl, lerFiltroHistorico, type ValoresFiltro } from './application/filtro-historico';
export {
  consultarHistorico,
  exportarHistorico,
  MENSAGEM_EXPORTACAO_LIMITE,
  registrarImpressao,
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
  senhaTemporaria,
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
export { BotaoImprimir } from './ui/botao-imprimir';
export { TelaHistorico } from './ui/tela-historico';
export { ListaUsuarios } from './ui/lista-usuarios';
export { seedAdministradorInicial } from './infrastructure/admin-inicial';
export { gerarSenhaTemporaria } from './infrastructure/gerar-senha';
export { seedAdm } from './infrastructure/seed';
export { conferirSenha, hashSenha } from './infrastructure/senha-argon2';
