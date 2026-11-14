import { randomUUID } from 'node:crypto';
import type { ErroCampo } from '@/shared/kernel';
import { auditarNegacao, obterContexto, obterMotivoAusencia } from './contexto';
import { exigir } from './exigir';
import { AUSENCIA_SESSAO, ErroPermissao, MENSAGEM_PERMISSAO, type Acao, type ContextoRequisicao } from './tipos';

export { MENSAGEM_PERMISSAO };
export const MENSAGEM_SESSAO = 'Sessão expirada. Entre novamente.';
export const MENSAGEM_INESPERADA = 'Erro inesperado. Tente novamente.';

// Código de correlação do erro inesperado (#177): a tela mostra, e o log grava junto. Com ele, o suporte acha o
// registro do erro sem a pessoa precisar descrever o que fez. Curto, sem dado pessoal.
export const novoCodigoErro = (): string => randomUUID().slice(0, 8).toUpperCase();
export const mensagemInesperada = (codigo: string): string => `${MENSAGEM_INESPERADA} Código: ${codigo}.`;

export const erroGeral = (mensagem: string): readonly ErroCampo[] => [{ campo: '_', mensagem }];

const contextoDoLog = (ctx: ContextoRequisicao | null) =>
  ctx && { usuarioId: ctx.usuarioId, sessaoUid: ctx.sessaoUid, ip: ctx.ip, unidadeId: ctx.unidadeId ?? null };

// Resumo do erro para log: nome, mensagem, pilha e a cadeia de causas. Nunca o objeto bruto
// (ex.: erro do Prisma com os argumentos da query) pode carregar dado pessoal.
export function resumirErro(erro: unknown, profundidade = 0): unknown {
  if (!(erro instanceof Error)) return String(erro);
  const causa = profundidade < 3 && erro.cause !== undefined ? resumirErro(erro.cause, profundidade + 1) : undefined;
  return { nome: erro.name, mensagem: erro.message, pilha: erro.stack, ...(causa === undefined ? {} : { causa }) };
}

// Log de erro inesperado com o contexto da requisição, o resumo do erro e o código de correlação, que volta
// para a tela.
export function registrarErroInesperado(
  onde: string,
  cfg: { funcionalidade: string; acao: Acao },
  ctx: ContextoRequisicao | null,
  erro: unknown,
): string {
  const codigo = novoCodigoErro();
  console.error(`[ERRO_INESPERADO] ${onde} ${cfg.funcionalidade} (${cfg.acao}) codigo=${codigo}`, {
    codigo,
    contexto: contextoDoLog(ctx),
    erro: resumirErro(erro),
  });
  return codigo;
}

// Negações repetidas do mesmo usuário para a mesma funcionalidade e ação são auditadas uma vez
// por janela: um script não enche o Histórico, que é imutável. As suprimidas são contadas e
// aparecem na próxima auditoria daquela chave.
const JANELA_MS = 5 * 60 * 1000;
const LIMITE_JANELA = 10_000;
const janela = new Map<string, { auditadaEm: number; suprimidas: number }>();

export function limparJanelaNegacoes(): void {
  janela.clear();
}

// Registra a negação no Histórico. Se a auditoria falhar, a resposta continua 403 (negar é
// sempre seguro) e o evento vai inteiro para o log, com marcador para busca e alerta.
export async function registrarNegacao(ctx: ContextoRequisicao, erro: ErroPermissao, emAcao?: string): Promise<void> {
  const { funcionalidade, acao } = erro;
  const chave = `${ctx.usuarioId}|${funcionalidade}|${acao}`;
  const agora = Date.now();
  const anterior = janela.get(chave);
  if (anterior && agora - anterior.auditadaEm < JANELA_MS) {
    anterior.suprimidas++;
    return;
  }
  const base =
    emAcao && emAcao !== funcionalidade
      ? `Acesso negado à funcionalidade ${funcionalidade} (${acao}) na ação ${emAcao}`
      : `Acesso negado à funcionalidade ${funcionalidade} (${acao})`;
  const suprimidas = anterior?.suprimidas ?? 0;
  const descricao =
    suprimidas > 0 ? `${base}; ${suprimidas} tentativas suprimidas desde a última auditoria` : base;
  try {
    await auditarNegacao({
      contexto: {
        usuarioId: ctx.usuarioId,
        usuarioRotulo: ctx.usuarioRotulo,
        sessaoUid: ctx.sessaoUid,
        ip: ctx.ip,
        unidadeId: ctx.unidadeId ?? null,
      },
      funcionalidade,
      tipo: 'SISTEMA',
      origem: 'SISTEMA',
      descricao,
    });
    // Só marca a janela depois de gravar: se a auditoria falhar, a próxima tentativa grava.
    if (!janela.has(chave) && janela.size >= LIMITE_JANELA) {
      const maisAntiga = janela.keys().next().value;
      if (maisAntiga !== undefined) janela.delete(maisAntiga);
    }
    janela.delete(chave);
    janela.set(chave, { auditadaEm: agora, suprimidas: 0 });
  } catch (falha) {
    console.error('[AUDITORIA_NEGACAO_FALHOU]', {
      contexto: contextoDoLog(ctx),
      funcionalidade,
      acao,
      descricao,
      erro: resumirErro(falha),
    });
  }
}

export type Autorizacao = { ok: true; ctx: ContextoRequisicao } | { ok: false; status: 401 | 403; mensagem: string };

// Passos comuns de definirAcao e definirRota: sessão e permissão da funcionalidade.
export async function autorizar(funcionalidade: string, acao: Acao): Promise<Autorizacao> {
  const ctx = await obterContexto();
  if (!ctx) {
    const motivo = await obterMotivoAusencia();
    return { ok: false, status: 401, mensagem: motivo ? AUSENCIA_SESSAO[motivo].mensagem : MENSAGEM_SESSAO };
  }
  try {
    exigir(ctx, funcionalidade, acao);
  } catch (erro) {
    if (!(erro instanceof ErroPermissao)) throw erro;
    await registrarNegacao(ctx, erro);
    return { ok: false, status: 403, mensagem: MENSAGEM_PERMISSAO };
  }
  return { ok: true, ctx };
}
