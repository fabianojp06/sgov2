import { autorizar, erroGeral, MENSAGEM_INESPERADA, MENSAGEM_PERMISSAO, MENSAGEM_SESSAO, registrarNegacao } from './guarda';
import { ErroPermissao, type Acao, type ContextoRequisicao } from './tipos';

const json = (status: number, mensagem: string) => Response.json({ erros: erroGeral(mensagem) }, { status });

// Todo Route Handler passa por aqui (US-008): sessão e permissão antes do handler.
export function definirRota(
  cfg: { funcionalidade: string; acao: Acao },
  executar: (req: Request, ctx: ContextoRequisicao) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    const autorizacao = await autorizar(cfg.funcionalidade, cfg.acao);
    if (!autorizacao.ok) {
      return json(autorizacao.status, autorizacao.status === 401 ? MENSAGEM_SESSAO : MENSAGEM_PERMISSAO);
    }
    try {
      return await executar(req, autorizacao.ctx);
    } catch (erro) {
      if (erro instanceof ErroPermissao) {
        await registrarNegacao(autorizacao.ctx, erro);
        return json(403, MENSAGEM_PERMISSAO);
      }
      console.error(`Erro inesperado na rota ${cfg.funcionalidade} (${cfg.acao})`, erro);
      return json(500, MENSAGEM_INESPERADA);
    }
  };
}
