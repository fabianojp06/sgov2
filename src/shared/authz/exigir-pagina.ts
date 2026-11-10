import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { obterContexto, obterMotivoAusencia } from './contexto';
import { exigir } from './exigir';
import { registrarNegacao } from './guarda';
import { ErroPermissao, type Acao, type ContextoRequisicao } from './tipos';

// Guarda de página (Server Component): toda page.tsx de (sistema) começa com ela, o que o teste de
// arquitetura impõe. A guarda do layout não basta: o App Router não renderiza o layout de novo na
// navegação entre páginas irmãs.
export async function exigirPagina(funcionalidade: string, acao: Acao): Promise<ContextoRequisicao> {
  // A página depende da sessão: nunca é pré-renderizada no build (sem o provedor, o build gravaria
  // um redirect para /login como página estática).
  await connection();
  const ctx = await obterContexto();
  if (!ctx) redirect((await obterMotivoAusencia()) === 'NOVO_ACESSO' ? '/login?motivo=novo-acesso' : '/login');
  if (ctx.trocaSenhaPendente && funcionalidade !== 'aut.senha') redirect('/troca-senha');
  try {
    exigir(ctx, funcionalidade, acao);
  } catch (erro) {
    if (!(erro instanceof ErroPermissao)) throw erro;
    await registrarNegacao(ctx, erro);
    notFound();
  }
  return ctx;
}

// Negação que vem do caso de uso depois da guarda (ex.: escopo do usuário): a página responde 404
// com a negação auditada, como a exigirPagina. Outros erros seguem.
export async function negarNaPagina(ctx: ContextoRequisicao, erro: unknown): Promise<never> {
  if (!(erro instanceof ErroPermissao)) throw erro;
  await registrarNegacao(ctx, erro);
  notFound();
}
