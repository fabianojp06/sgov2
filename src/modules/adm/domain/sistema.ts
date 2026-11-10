// Ativar e desativar o sistema (EP085 UC02.01; US-036). Arquivo puro: a tela (cliente) usa os mesmos
// textos que o servidor.
export const MENSAGENS_SISTEMA = {
  STATUS_ATIVO: 'O sistema encontra-se atualmente ATIVO',
  STATUS_INATIVO: 'O sistema encontra-se atualmente INATIVO',
  CONFIRMAR_ATIVAR: 'Deseja realmente ativar o sistema?',
  CONFIRMAR_DESATIVAR: 'Deseja realmente desativar o sistema?',
  ATIVADO: 'O sistema foi ativado com sucesso.',
  DESATIVADO: 'O sistema foi desativado com sucesso.',
  // E1 (RN0073).
  MOTIVO_OBRIGATORIO: 'Você deve informar o motivo da desativação do sistema.',
  // [PROVISÓRIO] Teto do motivo, para o Histórico não receber um texto sem limite.
  MOTIVO_LONGO: 'O motivo da desativação deve ter no máximo 500 caracteres.',
} as const;

export const MOTIVO_MAXIMO = 500;

// Funcionalidade do catálogo (C6) e chave da trava das mudanças de estado (D-P9-6).
export const FUNCIONALIDADE_SISTEMA = 'adm.sistema';
export const TRAVA_SISTEMA = 'adm:sistema';

const hora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
export const formatarHora = (d: Date): string => hora.format(d);

// D-P9-10 [PROVISÓRIOS]: a tela durante a contagem e o retorno de desativar com espera.
export const desativacaoAgendada = (em: Date): string => `A desativação do sistema está agendada para ${formatarHora(em)}.`;
export const desativacaoFoiAgendada = (em: Date): string => `A desativação do sistema foi agendada para ${formatarHora(em)}.`;

// Valida o motivo (RN0073): obrigatório, sem contar os espaços das pontas.
export function normalizarMotivo(motivo: unknown): { ok: true; motivo: string } | { ok: false; mensagem: string } {
  const texto = typeof motivo === 'string' ? motivo.trim() : '';
  if (texto === '') return { ok: false, mensagem: MENSAGENS_SISTEMA.MOTIVO_OBRIGATORIO };
  if (texto.length > MOTIVO_MAXIMO) return { ok: false, mensagem: MENSAGENS_SISTEMA.MOTIVO_LONGO };
  return { ok: true, motivo: texto };
}
