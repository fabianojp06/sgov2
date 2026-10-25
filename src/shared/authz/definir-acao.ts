import { unstable_rethrow } from 'next/navigation';
import type { z } from 'zod';
import { ErroDominio, type ErroCampo, type Resultado } from '@/shared/kernel';
import {
  autorizar,
  erroGeral,
  MENSAGEM_INESPERADA,
  MENSAGEM_PERMISSAO,
  MENSAGEM_SESSAO,
  registrarErroInesperado,
  registrarNegacao,
} from './guarda';
import { ErroPermissao, type Acao, type ContextoRequisicao, type RespostaAcao } from './tipos';

type ConfigAcao<I> = { funcionalidade: string; acao: Acao; entrada: z.ZodType<I> };

const ehResultado = (r: unknown): r is Resultado<unknown> =>
  typeof r === 'object' && r !== null && typeof (r as { ok?: unknown }).ok === 'boolean';

// Toda Server Action passa por aqui (US-008): sessão, permissão, validação da entrada e
// tradução de erros. Nunca lança para a tela (TRAVA O ERRO, spec §5): a única exceção são os
// sinais de navegação do Next (redirect, notFound), que precisam seguir adiante.
// A entrada é um valor único: com <form action>, converta o FormData antes de chamar.
export function definirAcao<I, O>(
  cfg: ConfigAcao<I>,
  executar: (entrada: I, ctx: ContextoRequisicao) => Promise<Resultado<O>>,
): (entradaBruta: unknown) => Promise<RespostaAcao<O>> {
  return async (entradaBruta) => {
    let ctx: ContextoRequisicao | null = null;
    try {
      const autorizacao = await autorizar(cfg.funcionalidade, cfg.acao);
      if (!autorizacao.ok) {
        const mensagem = autorizacao.status === 401 ? MENSAGEM_SESSAO : MENSAGEM_PERMISSAO;
        return { ok: false, status: autorizacao.status, erros: erroGeral(mensagem) };
      }
      ctx = autorizacao.ctx;

      const validado = await cfg.entrada.safeParseAsync(entradaBruta);
      if (!validado.success) {
        const erros: ErroCampo[] = validado.error.issues.map((i) => ({
          campo: i.path.length > 0 ? i.path.join('.') : '_',
          mensagem: i.message,
        }));
        return { ok: false, erros };
      }

      const resultado: unknown = await executar(validado.data, ctx);
      if (!ehResultado(resultado)) throw new Error('executar não devolveu um Resultado');
      return resultado as Resultado<O>;
    } catch (erro) {
      unstable_rethrow(erro);
      if (erro instanceof ErroPermissao && ctx) {
        await registrarNegacao(ctx, erro, cfg.funcionalidade);
        return { ok: false, status: 403, erros: erroGeral(MENSAGEM_PERMISSAO) };
      }
      // A mensagem de um ErroDominio é texto de tela: quem lança escreve para o usuário.
      if (erro instanceof ErroDominio) return { ok: false, erros: erroGeral(erro.message) };
      registrarErroInesperado('ação', cfg, ctx, erro);
      return { ok: false, erros: erroGeral(MENSAGEM_INESPERADA) };
    }
  };
}
