import type { PrismaClient } from '@/generated/prisma/client';
import { listarCatalogoAtivo, listarUnidadesDoUsuario, obterUsuarioParaSessao } from '@/modules/adm';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { prisma } from '@/shared/db';
import { montarMenu, type MenuModulo } from './menu';

type DepsTela = { cliente: PrismaClient };

export type DadosTelaPrincipal = {
  menu: readonly MenuModulo[];
  unidades: readonly { id: string; codigo: string; nome: string }[];
  unidadeAtiva: string | null;
  usuario: { nome: string; acessoEm: string }; // acessoEm em ISO 8601 (serializável para o cliente)
};

// Dados da tela principal (UC01.03): menu filtrado, TPs do usuário e a barra de status (REQ0046).
export async function carregarTelaPrincipal(ctx: ContextoRequisicao, deps: Partial<DepsTela> = {}): Promise<DadosTelaPrincipal> {
  const cliente = deps.cliente ?? prisma;
  const [catalogo, unidades, usuario, sessao] = await Promise.all([
    listarCatalogoAtivo(cliente),
    listarUnidadesDoUsuario(cliente, ctx.usuarioId),
    obterUsuarioParaSessao(cliente, ctx.usuarioId),
    cliente.sessaoUsuario.findFirst({ where: { usuarioId: ctx.usuarioId, sessaoUid: ctx.sessaoUid }, select: { criadaEm: true } }),
  ]);
  return {
    menu: montarMenu(catalogo, ctx.permissoes),
    unidades,
    unidadeAtiva: ctx.unidadeId ?? null,
    usuario: { nome: usuario?.nome ?? ctx.usuarioRotulo, acessoEm: (sessao?.criadaEm ?? new Date()).toISOString() },
  };
}

// Troca de TP (§6.7): só uma unidade ativa da lista do usuário. Fora dela é negação de acesso, que a
// guarda (definirAcao) audita.
export async function validarTrocaUnidade(ctx: ContextoRequisicao, unidadeId: string, deps: Partial<DepsTela> = {}): Promise<void> {
  const unidades = await listarUnidadesDoUsuario(deps.cliente ?? prisma, ctx.usuarioId);
  if (!unidades.some((u) => u.id === unidadeId)) throw new ErroPermissao('aut.unidade', 'alterar');
}
