import type { ErroCampo } from '@/shared/kernel';
import { auditarNegacao, obterContexto } from './contexto';
import { exigir } from './exigir';
import { ErroPermissao, MENSAGEM_PERMISSAO, type Acao, type ContextoRequisicao } from './tipos';

export { MENSAGEM_PERMISSAO };
export const MENSAGEM_SESSAO = 'Sessão expirada. Entre novamente.';
export const MENSAGEM_INESPERADA = 'Erro inesperado. Tente novamente.';

export const erroGeral = (mensagem: string): readonly ErroCampo[] => [{ campo: '_', mensagem }];

const contextoDoLog = (ctx: ContextoRequisicao | null) =>
  ctx && { usuarioId: ctx.usuarioId, sessaoUid: ctx.sessaoUid, ip: ctx.ip, unidadeId: ctx.unidadeId ?? null };

// Log de erro inesperado com o contexto da requisição e só o resumo do erro: o objeto bruto
// (ex.: erro do Prisma com os argumentos da query) pode carregar dado pessoal.
export function registrarErroInesperado(
  onde: string,
  cfg: { funcionalidade: string; acao: Acao },
  ctx: ContextoRequisicao | null,
  erro: unknown,
): void {
  const resumo = erro instanceof Error ? { nome: erro.name, mensagem: erro.message, pilha: erro.stack } : String(erro);
  console.error(`[ERRO_INESPERADO] ${onde} ${cfg.funcionalidade} (${cfg.acao})`, {
    contexto: contextoDoLog(ctx),
    erro: resumo,
  });
}

// Negações repetidas do mesmo usuário para a mesma funcionalidade e ação são auditadas uma vez
// por janela: um script não enche o Histórico, que é imutável.
const JANELA_MS = 5 * 60 * 1000;
const LIMITE_JANELA = 10_000;
const ultimasNegacoes = new Map<string, number>();

export function limparJanelaNegacoes(): void {
  ultimasNegacoes.clear();
}

function jaAuditadaNaJanela(chave: string): boolean {
  const agora = Date.now();
  const anterior = ultimasNegacoes.get(chave);
  if (anterior !== undefined && agora - anterior < JANELA_MS) return true;
  if (ultimasNegacoes.size >= LIMITE_JANELA) ultimasNegacoes.clear();
  ultimasNegacoes.set(chave, agora);
  return false;
}

// Registra a negação no Histórico. Se a auditoria falhar, a resposta continua 403 (negar é
// sempre seguro) e o evento vai inteiro para o log, com marcador para busca e alerta.
export async function registrarNegacao(ctx: ContextoRequisicao, erro: ErroPermissao, emAcao?: string): Promise<void> {
  const { funcionalidade, acao } = erro;
  if (jaAuditadaNaJanela(`${ctx.usuarioId}|${funcionalidade}|${acao}`)) return;
  const descricao =
    emAcao && emAcao !== funcionalidade
      ? `Acesso negado à funcionalidade ${funcionalidade} (${acao}) na ação ${emAcao}`
      : `Acesso negado à funcionalidade ${funcionalidade} (${acao})`;
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
  } catch (falha) {
    console.error('[AUDITORIA_NEGACAO_FALHOU]', {
      contexto: contextoDoLog(ctx),
      funcionalidade,
      acao,
      descricao,
      erro: falha instanceof Error ? falha.message : String(falha),
    });
  }
}

export type Autorizacao = { ok: true; ctx: ContextoRequisicao } | { ok: false; status: 401 | 403 };

// Passos comuns de definirAcao e definirRota: sessão e permissão da funcionalidade.
export async function autorizar(funcionalidade: string, acao: Acao): Promise<Autorizacao> {
  const ctx = await obterContexto();
  if (!ctx) return { ok: false, status: 401 };
  try {
    exigir(ctx, funcionalidade, acao);
  } catch (erro) {
    if (!(erro instanceof ErroPermissao)) throw erro;
    await registrarNegacao(ctx, erro);
    return { ok: false, status: 403 };
  }
  return { ok: true, ctx };
}
