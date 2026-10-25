import type { ErroCampo } from '@/shared/kernel';
import { auditarNegacao, obterContexto } from './contexto';
import { exigir } from './exigir';
import { ErroPermissao, type Acao, type ContextoRequisicao } from './tipos';

export const MENSAGEM_SESSAO = 'Sessão expirada. Entre novamente.';
export const MENSAGEM_PERMISSAO = 'Você não tem permissão para esta ação.';
export const MENSAGEM_INESPERADA = 'Erro inesperado. Tente novamente.';

export const erroGeral = (mensagem: string): readonly ErroCampo[] => [{ campo: '_', mensagem }];

// Registra a negação no Histórico. Se a auditoria falhar, a resposta continua 403
// (negar é sempre seguro) e a falha vai para o log.
export async function registrarNegacao(ctx: ContextoRequisicao, erro: ErroPermissao): Promise<void> {
  const { funcionalidade, acao } = erro.detalhes as { funcionalidade: string; acao: Acao };
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
      descricao: `Acesso negado à funcionalidade ${funcionalidade} (${acao})`,
    });
  } catch (falha) {
    console.error(`Falha ao auditar acesso negado a ${funcionalidade} (${acao})`, falha);
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
