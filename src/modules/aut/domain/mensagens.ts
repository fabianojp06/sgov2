// Mensagens do login (EP084 UC01.01) e a da senha temporária expirada [PROVISÓRIA] (spec §11.2a).
// Arquivo puro: a tela de login (cliente) usa os mesmos textos que o servidor.
export const MENSAGENS = {
  OBRIGATORIOS: 'Login e/ou Senha são obrigatórios',
  CREDENCIAIS: 'Login ou senha inválidos',
  BLOQUEADO: 'Usuário bloqueado. Contate o Administrador do sistema.',
  MANUTENCAO: 'Sistema está em manutenção',
  ULTIMA_TENTATIVA: 'Atenção: resta 1 (uma) tentativa antes do bloqueio da conta.',
  FALHA_SESSAO: 'Não foi possível iniciar sua sessão. Tente novamente.',
  SENHA_EXPIRADA: 'Senha temporária expirada. Solicite uma nova senha ao Administrador.',
  // EP084 UC01.01 E5 e A1.5 (US-029).
  LOGIN_OBRIGATORIO_RECUPERACAO: 'O campo Login é obrigatório para redefinir a senha',
  RECUPERACAO_ENVIADA:
    'Se o login informado estiver cadastrado com um e-mail válido, uma nova senha será enviada para o e-mail registrado. Caso não a receba, contate o Administrador do sistema.',
} as const;
