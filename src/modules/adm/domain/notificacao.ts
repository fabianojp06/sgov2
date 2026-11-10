import { falha, MENSAGEM_CONFLITO, ok, Percentual, type ErroCampo, type Resultado } from '@/shared/kernel';

// Notificações de desempenho das contas (US-041; EP085 UC02.20, grupo "Desempenho"; plano do P10,
// D-P10-6 a D-P10-9). Só a configuração: o envio vem com o realizado (US-085).

/** Valor do select para a opção "Todas" (RN0051); gravado como conta nula. */
export const CONTA_TODAS = '*';
export const ROTULO_TODAS = 'Todas';

// O A2 e o A3 do UC02.20 pedem as mensagens sem dar o texto: todas [PROVISÓRIAS] (D-P10-9).
export const MENSAGENS_NOTIFICACAO = {
  CONTA: 'Selecione a conta sintética.',
  CONTA_INVALIDA: 'Selecione uma conta sintética ativa ou a opção Todas.',
  CONTA_INEXISTENTE: 'Conta inexistente ou inativa',
  LIMITE: 'Informe o limite em % do orçado: maior que zero, até 999,99 e com no máximo duas casas decimais.',
  FREQUENCIA: 'Informe a frequência em dias: um número inteiro de 1 a 365.',
  USUARIO: 'O usuário é obrigatório.',
  USUARIO_INATIVO: 'Selecione um usuário ativo cadastrado no sistema.',
  DUPLICADA: 'Este usuário já recebe a notificação desta conta.',
  INATIVA: 'Esta notificação já foi excluída.',
  INEXISTENTE: 'Notificação não encontrada',
  CONFIRMAR_EXCLUSAO: 'Deseja realmente excluir esta notificação?',
  ALTERADO: MENSAGEM_CONFLITO,
} as const;

export type NotificacaoValidada = {
  /** Classificação da conta sintética; null é "Todas". */
  conta: string | null;
  /** Pontos percentuais em texto decimal com ponto ("80.5"), nunca number (spec §5). */
  limite: string;
  frequenciaDias: number;
  usuarioId: string;
};

const CLASSIFICACAO = /^\d{1,9}(\.\d{1,9}){0,8}$/;
// Até 3 dígitos inteiros e 2 casas, ponto ou vírgula: mais casas é recusado, não arredondado.
const LIMITE = /^\d{1,3}([.,]\d{1,2})?$/;
const DIAS = /^\d{1,3}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Campo<T> = { valor: T } | { erro: ErroCampo };

function conta(v: unknown): Campo<string | null> {
  if (v === null || v === CONTA_TODAS) return { valor: null };
  if (typeof v !== 'string' || v.trim() === '') return { erro: { campo: 'conta', mensagem: MENSAGENS_NOTIFICACAO.CONTA } };
  const t = v.trim();
  return CLASSIFICACAO.test(t) ? { valor: t } : { erro: { campo: 'conta', mensagem: MENSAGENS_NOTIFICACAO.CONTA_INVALIDA } };
}

function limite(v: unknown): Campo<string> {
  const erro = { erro: { campo: 'limite', mensagem: MENSAGENS_NOTIFICACAO.LIMITE } };
  if (typeof v !== 'string') return erro;
  const t = v.trim();
  if (!LIMITE.test(t)) return erro;
  const texto = t.replace(',', '.');
  // O formato já limita a 999,99; o Percentual (Decimal) confere o maior que zero sem number.
  return Percentual.dePontos(texto).comoFracao().isZero() ? erro : { valor: texto };
}

function frequencia(v: unknown): Campo<number> {
  const n = typeof v === 'string' && DIAS.test(v.trim()) ? Number(v.trim()) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 365
    ? { valor: n }
    : { erro: { campo: 'frequenciaDias', mensagem: MENSAGENS_NOTIFICACAO.FREQUENCIA } };
}

function usuario(v: unknown): Campo<string> {
  return typeof v === 'string' && UUID.test(v.trim()) ? { valor: v.trim().toLowerCase() } : { erro: { campo: 'usuarioId', mensagem: MENSAGENS_NOTIFICACAO.USUARIO } };
}

/** Formato e faixa (REQ0091, RN0067); conta sintética ativa e usuário ativo são conferidos no banco. */
export function validarNotificacao(entrada: unknown): Resultado<NotificacaoValidada> {
  const e = (typeof entrada === 'object' && entrada !== null ? entrada : {}) as Record<string, unknown>;
  const c = conta(e.conta);
  const l = limite(e.limite);
  const f = frequencia(e.frequenciaDias);
  const u = usuario(e.usuarioId);
  if ('erro' in c || 'erro' in l || 'erro' in f || 'erro' in u) {
    return falha([c, l, f, u].flatMap((x) => ('erro' in x ? [x.erro] : [])));
  }
  return ok({ conta: c.valor, limite: l.valor, frequenciaDias: f.valor, usuarioId: u.valor });
}
