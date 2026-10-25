import { ErroPermissao, type Acao, type ContextoRequisicao } from './tipos';

export function exigir(ctx: ContextoRequisicao, funcionalidade: string, acao: Acao): void {
  if (!ctx.permissoes.has(`${funcionalidade}:${acao}`)) throw new ErroPermissao(funcionalidade, acao);
}
