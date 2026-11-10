// Módulos e funcionalidades (US-035; EP085 UC02.05 e UC02.06). O catálogo vem só da seed (C14):
// aqui o Administrador apenas ativa e desativa.

// O módulo de Administração e as funcionalidades dele não podem ser desativados (D-P9-7): o
// Administrador perderia o acesso de todos, inclusive o dele.
export const MODULO_PROTEGIDO = 'ADMINISTRACAO';

export const MENSAGENS_MODULOS = {
  // UC02.05 e UC02.06, textos da especificação.
  CONFIRMAR_ATIVAR_MODULO: 'Deseja realmente ativar o módulo?',
  CONFIRMAR_DESATIVAR_MODULO: 'Deseja realmente desativar o módulo?',
  CONFIRMAR_ATIVAR_FUNCIONALIDADE: 'Deseja realmente ativar esta funcionalidade?',
  CONFIRMAR_DESATIVAR_FUNCIONALIDADE: 'Deseja realmente desativar a funcionalidade?',
  // [PROVISÓRIO] D-P9-7.
  MODULO_PROTEGIDO: 'O módulo de Administração não pode ser desativado.',
  // [PROVISÓRIO] D-P9-7.
  FUNCIONALIDADE_PROTEGIDA: 'As funcionalidades da Administração não podem ser desativadas.',
  // [PROVISÓRIO] D-P9-7.
  MODULO_INATIVO: 'Ative o módulo antes da funcionalidade.',
  // [PROVISÓRIO] sem texto na especificação.
  MODULO_INEXISTENTE: 'Módulo não encontrado.',
  // [PROVISÓRIO] sem texto na especificação.
  FUNCIONALIDADE_INEXISTENTE: 'Funcionalidade não encontrada.',
} as const;

// Histórico de Operações (UC02.05 passos 7 e A1 1.8; UC02.06 passos 8 e A1 4.5).
export const descricaoModulo = (ativo: boolean, nome: string) => `${ativo ? 'Ativou' : 'Desativou'} o módulo ${nome}`;
export const descricaoFuncionalidade = (ativo: boolean, nome: string) => `${ativo ? 'Ativou' : 'Desativou'} a funcionalidade ${nome}`;

// O botão Desativar não aparece para o que é protegido; o servidor recusa do mesmo jeito.
export const podeDesativarModulo = (codigoModulo: string) => codigoModulo !== MODULO_PROTEGIDO;
