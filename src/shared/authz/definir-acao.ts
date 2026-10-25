import type { z } from 'zod';
import { ErroDominio, type ErroCampo, type Resultado } from '@/shared/kernel';
import {
  autorizar,
  erroGeral,
  MENSAGEM_INESPERADA,
  MENSAGEM_PERMISSAO,
  MENSAGEM_SESSAO,
  registrarNegacao,
} from './guarda';
import { ErroPermissao, type Acao, type ContextoRequisicao, type RespostaAcao } from './tipos';

type ConfigAcao<I> = { funcionalidade: string; acao: Acao; entrada: z.ZodType<I> };

// Toda Server Action passa por aqui (US-008): sessão, permissão, validação da entrada e
// tradução de erros. Nunca lança: a tela recebe sempre um Resultado (TRAVA O ERRO).
export function definirAcao<I, O>(
  cfg: ConfigAcao<I>,
  executar: (entrada: I, ctx: ContextoRequisicao) => Promise<Resultado<O>>,
): (entradaBruta: unknown) => Promise<RespostaAcao<O>> {
  return async (entradaBruta) => {
    const autorizacao = await autorizar(cfg.funcionalidade, cfg.acao);
    if (!autorizacao.ok) {
      const mensagem = autorizacao.status === 401 ? MENSAGEM_SESSAO : MENSAGEM_PERMISSAO;
      return { ok: false, status: autorizacao.status, erros: erroGeral(mensagem) };
    }
    const { ctx } = autorizacao;

    const validado = cfg.entrada.safeParse(entradaBruta);
    if (!validado.success) {
      const erros: ErroCampo[] = validado.error.issues.map((i) => ({
        campo: i.path.length > 0 ? i.path.join('.') : '_',
        mensagem: i.message,
      }));
      return { ok: false, erros };
    }

    try {
      return await executar(validado.data, ctx);
    } catch (erro) {
      if (erro instanceof ErroPermissao) {
        await registrarNegacao(ctx, erro);
        return { ok: false, status: 403, erros: erroGeral(MENSAGEM_PERMISSAO) };
      }
      if (erro instanceof ErroDominio) return { ok: false, erros: erroGeral(erro.message) };
      console.error(`Erro inesperado na ação ${cfg.funcionalidade} (${cfg.acao})`, erro);
      return { ok: false, erros: erroGeral(MENSAGEM_INESPERADA) };
    }
  };
}
