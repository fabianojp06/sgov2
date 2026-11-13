import 'server-only';
import type { PrismaClient } from '@/generated/prisma/client';
import { listarCatalogoDoMenu } from '@/modules/adm';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma, type TxCliente } from '@/shared/db';
import { montarManual, roteiroTreinamento, type ModuloManual, type PassoTreinamento } from '../domain/manual';

// Manual do usuário e roteiro de treinamento (US-118): do catálogo ativo do menu e das permissões da
// pessoa. Quem entra no sistema lê o próprio manual (a mesma permissão da tela principal).

type Deps = { cliente?: PrismaClient };
export type TelaManual = Readonly<{ manual: readonly ModuloManual[]; roteiro: readonly PassoTreinamento[] }>;

export async function obterManual(ctx: ContextoRequisicao, deps: Deps = {}): Promise<TelaManual> {
  exigir(ctx, 'aut.tela_principal', 'consultar');
  const catalogo = await (deps.cliente ?? prisma).$transaction((tx: TxCliente) => listarCatalogoDoMenu(tx));
  const manual = montarManual(catalogo, ctx.permissoes);
  return { manual, roteiro: roteiroTreinamento(manual) };
}
