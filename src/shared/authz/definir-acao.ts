import { unstable_rethrow } from 'next/navigation';
import type { z } from 'zod';
import { ErroDominio, type Resultado } from '@/shared/kernel';
import {
  autorizar,
  erroGeral,
  mensagemInesperada,
  MENSAGEM_PERMISSAO,
  registrarErroInesperado,
  registrarNegacao,
} from './guarda';
import { validarEntrada } from './validar-entrada';
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
        return { ok: false, status: autorizacao.status, erros: erroGeral(autorizacao.mensagem) };
      }
      ctx = autorizacao.ctx;

      const validado = await validarEntrada(cfg.entrada, entradaBruta);
      if (!validado.ok) return { ok: false, erros: validado.erros };

      const resultado: unknown = await executar(validado.valor, ctx);
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
      return { ok: false, erros: erroGeral(mensagemInesperada(registrarErroInesperado('ação', cfg, ctx, erro))) };
    }
  };
}
