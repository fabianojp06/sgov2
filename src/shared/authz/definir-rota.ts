import { unstable_rethrow } from 'next/navigation';
import { ErroDominio } from '@/shared/kernel';
import {
  autorizar,
  erroGeral,
  mensagemInesperada,
  MENSAGEM_PERMISSAO,
  registrarErroInesperado,
  registrarNegacao,
} from './guarda';
import { ErroPermissao, type Acao, type ContextoRequisicao } from './tipos';

// Segundo argumento que o Next passa aos Route Handlers (rotas dinâmicas: params).
export type ContextoRota = { params: Promise<unknown> };

const json = (status: number, mensagem: string) => Response.json({ erros: erroGeral(mensagem) }, { status });

const MENSAGEM_ORIGEM = 'Requisição recusada: origem inválida.';

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

// CSRF: Server Actions já têm a checagem de Origin do Next; Route Handlers não. Métodos que
// alteram dados só são aceitos da mesma origem.
function mesmaOrigem(req: Request): boolean {
  if (METODOS_SEGUROS.has(req.method.toUpperCase())) return true;
  const site = req.headers.get('sec-fetch-site');
  if (site !== null) return site === 'same-origin';
  const origem = req.headers.get('origin');
  if (origem === null) return false;
  try {
    return new URL(origem).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

// Todo Route Handler passa por aqui (US-008): origem, sessão e permissão antes do handler.
export function definirRota(
  cfg: { funcionalidade: string; acao: Acao },
  executar: (req: Request, ctx: ContextoRequisicao, rota?: ContextoRota) => Promise<Response>,
): (req: Request, rota?: ContextoRota) => Promise<Response> {
  return async (req, rota) => {
    if (!mesmaOrigem(req)) {
      // Pode ser ataque ou proxy mal configurado (Host reescrito): o log ajuda a distinguir.
      console.warn('[AUTHZ_ORIGEM_RECUSADA]', {
        funcionalidade: cfg.funcionalidade,
        metodo: req.method,
        secFetchSite: req.headers.get('sec-fetch-site'),
        origin: req.headers.get('origin'),
        host: new URL(req.url).host,
      });
      return json(403, MENSAGEM_ORIGEM);
    }
    let ctx: ContextoRequisicao | null = null;
    try {
      const autorizacao = await autorizar(cfg.funcionalidade, cfg.acao);
      if (!autorizacao.ok) {
        return json(autorizacao.status, autorizacao.mensagem);
      }
      ctx = autorizacao.ctx;
      return await executar(req, ctx, rota);
    } catch (erro) {
      unstable_rethrow(erro);
      if (erro instanceof ErroPermissao && ctx) {
        await registrarNegacao(ctx, erro, cfg.funcionalidade);
        return json(403, MENSAGEM_PERMISSAO);
      }
      if (erro instanceof ErroDominio) return json(422, erro.message);
      return json(500, mensagemInesperada(registrarErroInesperado('rota', cfg, ctx, erro)));
    }
  };
}
