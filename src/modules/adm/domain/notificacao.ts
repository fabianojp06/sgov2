import { falha, ok, Percentual, type ErroCampo, type Resultado } from '@/shared/kernel';
import { CONTA_TODAS, MENSAGENS_NOTIFICACAO } from './notificacao-textos';

export { CONTA_TODAS, MENSAGENS_NOTIFICACAO, ROTULO_TODAS } from './notificacao-textos';

// Notificações de desempenho das contas (US-041; EP085 UC02.20, grupo "Desempenho"; plano do P10,
// D-P10-6 a D-P10-9). Só a configuração: o envio vem com o realizado (US-085).

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
