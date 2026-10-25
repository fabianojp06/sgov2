// Tipos de operação do Histórico (RN0103) e origem da ação (spec §4.4: IA sugere, não grava).
export const TIPOS_OPERACAO = [
  'INSERCAO',
  'ALTERACAO',
  'EXCLUSAO',
  'CONSULTA',
  'IMPRESSAO',
  'EXPORTACAO',
  'LOGIN',
  'LOGOFF',
  'SISTEMA',
] as const;
export type TipoOperacao = (typeof TIPOS_OPERACAO)[number];

export const ORIGENS_OPERACAO = ['USUARIO', 'SISTEMA', 'SUGESTAO_IA'] as const;
export type OrigemOperacao = (typeof ORIGENS_OPERACAO)[number];

export type ContextoAuditoria = {
  usuarioId: string | null;
  usuarioRotulo: string;
  sessaoUid: string | null;
  ip: string | null;
  unidadeId?: string | null;
};

export type EventoAuditoria = {
  contexto: ContextoAuditoria;
  funcionalidade: string;
  tipo: TipoOperacao;
  registroId?: string;
  descricao?: string;
  antes?: unknown;
  depois?: unknown;
  origem?: OrigemOperacao;
};
