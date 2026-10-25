import { NextResponse } from 'next/server';
import type { PrismaClient } from '@/generated/prisma/client';
import { auditar } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { COOKIE_UNIDADE, lerEnvAcesso, nomeCookieSessao } from '@/shared/config';
import { prisma } from '@/shared/db';

type DepsSair = { cliente: PrismaClient };

// Logoff (UC01.04): apaga as sessões do usuário e registra LOGOFF na mesma transação (RN0522,
// RN0029, RNF0013). Se a auditoria falhar, nada muda.
export async function sair(ctx: ContextoRequisicao, deps: Partial<DepsSair> = {}): Promise<void> {
  const cliente = deps.cliente ?? prisma;
  await cliente.$transaction(async (tx) => {
    await tx.sessaoUsuario.deleteMany({ where: { usuarioId: ctx.usuarioId } });
    await auditar(tx, {
      contexto: { usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip },
      funcionalidade: 'aut.sessao',
      tipo: 'LOGOFF',
      descricao: 'Logoff',
    });
  });
}

// Resposta da rota POST /aut/sair: 204 com os cookies limpos e o armazenamento do navegador
// apagado (RNF0010). Sem "cookies" no Clear-Site-Data, que alcançaria o domínio inteiro. Mesmo
// quando a rota responde 401 (sessão já expirada), o cliente segue para /login?saiu=1, onde o
// proxy limpa os cookies.
export function responderSair(deps: Partial<DepsSair> = {}) {
  return async (_req: Request, ctx: ContextoRequisicao): Promise<Response> => {
    await sair(ctx, deps);
    const env = lerEnvAcesso();
    const resposta = new NextResponse(null, { status: 204 });
    const opcoes = { maxAge: 0, path: '/', httpOnly: true, secure: env.seguro, sameSite: 'lax' as const };
    resposta.cookies.set(nomeCookieSessao(env), '', opcoes);
    resposta.cookies.set(COOKIE_UNIDADE, '', opcoes);
    resposta.headers.set('Clear-Site-Data', '"storage"');
    return resposta;
  };
}
