'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { definirAcao } from '@/shared/authz';
import { falha } from '@/shared/kernel';
import { conferirOrigemBlindadaCargo } from './cargos';
import { alterarFaixaSalarial, copiarFaixaParaCargo, inativarFaixaSalarial, inativarSenioridade, incluirFaixaSalarial, incluirSenioridade } from './tabela-salarial';

// Server Actions da tabela salarial (US-049 parte 3). A negação (403) é auditada pela definirAcao (C5).
const id = z.string().max(36);
const dinheiro = z.string().max(30, 'Informe o valor com até 2 casas decimais.');
const faixa = { cargoId: id, senioridadeId: id, minimo: dinheiro, maximo: dinheiro };
const atualizar = () => {
  revalidatePath('/cad/tabela-salarial');
  revalidatePath('/cad/cargos');
};

export const acaoIncluirFaixa = definirAcao({ funcionalidade: 'cad.tabela_salarial', acao: 'incluir', entrada: z.object(faixa).strict() }, async (e, ctx) => {
  const r = await incluirFaixaSalarial(ctx, e);
  if (r.ok) atualizar();
  return r;
});

export const acaoAlterarFaixa = definirAcao(
  { funcionalidade: 'cad.tabela_salarial', acao: 'alterar', entrada: z.object({ ...faixa, idFaixa: id, versao: z.number().int() }).strict() },
  async ({ idFaixa, versao, ...e }, ctx) => {
    const r = await alterarFaixaSalarial(ctx, idFaixa, versao, e);
    if (r.ok) atualizar();
    return r;
  },
);

export const acaoInativarFaixa = definirAcao(
  { funcionalidade: 'cad.tabela_salarial', acao: 'excluir', entrada: z.object({ idFaixa: id, versao: z.number().int() }).strict() },
  async (e, ctx) => {
    const r = await inativarFaixaSalarial(ctx, e.idFaixa, e.versao);
    if (r.ok) atualizar();
    return r;
  },
);

export const acaoIncluirSenioridade = definirAcao(
  { funcionalidade: 'cad.tabela_salarial', acao: 'incluir', entrada: z.object({ nome: z.string().max(60, 'Informe o nome da senioridade, com até 40 caracteres.') }).strict() },
  async (e, ctx) => {
    const r = await incluirSenioridade(ctx, e.nome);
    if (r.ok) atualizar();
    return r;
  },
);

export const acaoInativarSenioridade = definirAcao(
  { funcionalidade: 'cad.tabela_salarial', acao: 'excluir', entrada: z.object({ idSenioridade: id }).strict() },
  async (e, ctx) => {
    const r = await inativarSenioridade(ctx, e.idSenioridade);
    if (r.ok) atualizar();
    return r;
  },
);

// REQ_TAB_003: a cópia mexe no cargo (cad.cargos:alterar, e cad.salarios no caso de uso).
// A entrada chega bruta para a origem blindada do cargo ser auditada antes do parse (M-n4).
const esquemaCopia = z.object({ idCargo: id, idFaixa: id, versaoFaixa: z.number().int(), versao: z.number().int() }).strict();
export const acaoCopiarFaixaParaCargo = definirAcao({ funcionalidade: 'cad.cargos', acao: 'alterar', entrada: z.unknown() }, async (bruto, ctx) => {
  await conferirOrigemBlindadaCargo(ctx, bruto);
  const e = esquemaCopia.safeParse(bruto);
  if (!e.success) return falha([{ campo: '_', mensagem: 'Pedido inválido. Recarregue a tela.' }]);
  const r = await copiarFaixaParaCargo(ctx, e.data.idCargo, e.data.idFaixa, e.data.versaoFaixa, e.data.versao);
  if (r.ok) atualizar();
  return r;
});
