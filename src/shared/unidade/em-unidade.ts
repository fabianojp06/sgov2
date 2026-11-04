import { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import { ErroPermissao, type Acao, type ContextoRequisicao } from '@/shared/authz';
import { prisma, type TxCliente } from '@/shared/db';

// Isolamento por unidade (TP), US-007 (spec §5, C31): duas camadas.
// 1. RLS no banco: toda leitura ou escrita de tabela de TP passa por emUnidade (ou aplicarUnidades,
//    para quem já tem um tx), que define app.unidades só para a transação (set_config local). Fora
//    dela, a variável não existe e a política não deixa ver nada: o cliente raiz vê zero linhas.
// 2. Guarda da unidade ativa: filtroUnidadeAtiva(ctx) vai no `where` das consultas de TP, para
//    a tela mostrar só o TP escolhido no seletor (§6.7), dentro do que a RLS já limita.
// A política padrão de uma tabela de TP (R4 em diante) está na migration 202611041400_nucleo_app_unidades.
// Pendências: o worker (realizado, F5) e o Consolidado dos TPs (§6.7) precisam de um caminho próprio;
// o papel sgo_leitura não tem EXECUTE em app_unidades() (recebe "permission denied" numa tabela de TP).
const uuid = z.uuid();

// Só uuids válidos entram na lista (o valor vai como parâmetro, mas a lista é um literal de array).
function literalUnidades(ctx: ContextoRequisicao): string {
  const validas = (ctx.unidades ?? []).filter((u) => uuid.safeParse(u).success);
  return `{${validas.join(',')}}`;
}

export async function aplicarUnidades(tx: TxCliente, ctx: ContextoRequisicao): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.unidades', ${literalUnidades(ctx)}, true)`;
}

export async function emUnidade<T>(
  ctx: ContextoRequisicao,
  fn: (tx: TxCliente) => Promise<T>,
  deps: { cliente?: PrismaClient; timeoutMs?: number } = {},
): Promise<T> {
  return (deps.cliente ?? prisma).$transaction(
    async (tx) => {
      await aplicarUnidades(tx, ctx);
      return fn(tx);
    },
    deps.timeoutMs === undefined ? undefined : { timeout: deps.timeoutMs },
  );
}

// A unidade ativa do seletor, que precisa estar entre as do usuário; sem ela, a operação de TP é negada
// com a funcionalidade e a ação de quem chama (o que vai à negação auditada).
export function filtroUnidadeAtiva(ctx: ContextoRequisicao, funcionalidade: string, acao: Acao): { unidadeId: string } {
  const ativa = ctx.unidadeId;
  if (!ativa || !(ctx.unidades ?? []).includes(ativa)) throw new ErroPermissao(funcionalidade, acao);
  return { unidadeId: ativa };
}
