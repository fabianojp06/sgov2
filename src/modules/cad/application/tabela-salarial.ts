import 'server-only';
import type { PrismaClient } from '@/generated/prisma/client';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma, type TxCliente } from '@/shared/db';
import { Dinheiro, falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { dinheiroDoTexto } from '../domain/cargo';
import type { FaixaTela, SenioridadeTela } from '../domain/cargo-tela';
import { MSG_CONCORRENCIA } from '../infrastructure/parametro-sistema';

// Tabela salarial de mercado e senioridades (US-049 parte 3; plano do P4, Task 12c; UC03.19 §5,
// REQ_TAB_001 a 005, RN_TAB_01 a 04). Referência de pesquisa externa, em claro; sem vínculo com a
// tabela/faixa/nível do Rubi. A exclusão é inativação. Tudo auditado no mesmo tx.

type Deps = { cliente?: PrismaClient };
const FUNC = 'cad.tabela_salarial';

const contextoDe = (ctx: ContextoRequisicao) => ({
  usuarioId: ctx.usuarioId,
  usuarioRotulo: ctx.usuarioRotulo,
  sessaoUid: ctx.sessaoUid,
  ip: ctx.ip,
  unidadeId: ctx.unidadeId ?? null,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


export const MSG_SENIORIDADE_PADRAO = 'Júnior, Pleno e Sênior são padrão e não podem ser inativadas.';
export const MSG_SENIORIDADE_COM_FAIXA = 'Esta senioridade tem faixa salarial ativa: inative as faixas antes.';

/** Cargos ativos para escolher na faixa (sem salários: só código e nome). */
export async function listarOpcoesCargos(ctx: ContextoRequisicao, deps: Deps = {}): Promise<readonly { id: string; rotulo: string }[]> {
  exigir(ctx, FUNC, 'consultar');
  const cargos = await (deps.cliente ?? prisma).cargo.findMany({ where: { ativo: true }, select: { id: true, codigo: true, nomeOficial: true }, orderBy: { codigo: 'asc' } });
  return cargos.map((c) => ({ id: c.id, rotulo: `${c.codigo} — ${c.nomeOficial}` }));
}

/** Faixas (todas, ou só as de um cargo) e as senioridades, para a tela. */
export async function listarTabelaSalarial(
  ctx: ContextoRequisicao,
  filtro: { cargoId?: string } = {},
  deps: Deps = {},
): Promise<{ faixas: readonly FaixaTela[]; senioridades: readonly SenioridadeTela[] }> {
  exigir(ctx, FUNC, 'consultar');
  const cliente = deps.cliente ?? prisma;
  const cargoId = filtro.cargoId && UUID.test(filtro.cargoId) ? filtro.cargoId : undefined;
  const faixas = await cliente.faixaSalarial.findMany({
    where: cargoId ? { cargoId } : {},
    include: { cargo: { select: { codigo: true, nomeOficial: true } }, senioridade: { select: { nome: true, ordem: true } } },
    orderBy: [{ cargo: { codigo: 'asc' } }, { senioridade: { ordem: 'asc' } }, { minimo: 'asc' }],
  });
  const senioridades = await cliente.senioridade.findMany({ orderBy: [{ ordem: 'asc' }, { nome: 'asc' }] });
  return {
    faixas: faixas.map((f) => ({
      id: f.id,
      cargoId: f.cargoId,
      cargo: `${f.cargo.codigo} — ${f.cargo.nomeOficial}`,
      senioridadeId: f.senioridadeId,
      senioridade: f.senioridade.nome,
      minimo: f.minimo.toFixed(2),
      maximo: f.maximo.toFixed(2),
      ativa: f.ativa,
      versao: f.versao,
    })),
    senioridades: senioridades.map((s) => ({ id: s.id, nome: s.nome, padrao: s.padrao, ativa: s.ativa })),
  };
}

export type EntradaFaixa = { cargoId: string; senioridadeId: string; minimo: string; maximo: string };

/** RN_TAB_02: mínimo e máximo obrigatórios, 0 < mínimo < máximo, com erro nos dois campos. */
function validarFaixa(e: EntradaFaixa): Resultado<{ minimo: Dinheiro; maximo: Dinheiro }> {
  const erros: ErroCampo[] = [];
  const minimo = dinheiroDoTexto(e.minimo);
  const maximo = dinheiroDoTexto(e.maximo);
  if (!(minimo instanceof Dinheiro) || minimo.ehZero()) erros.push({ campo: 'minimo', mensagem: 'Informe o salário mínimo, maior que zero, com até 2 casas decimais.' });
  if (!(maximo instanceof Dinheiro)) erros.push({ campo: 'maximo', mensagem: 'Informe o salário máximo, com até 2 casas decimais.' });
  if (minimo instanceof Dinheiro && maximo instanceof Dinheiro && minimo.comparar(maximo) >= 0) {
    const mensagem = 'O salário mínimo deve ser menor que o máximo.';
    erros.push({ campo: 'minimo', mensagem }, { campo: 'maximo', mensagem });
  }
  if (!UUID.test(e.cargoId)) erros.push({ campo: 'cargoId', mensagem: 'Escolha o cargo.' });
  if (!UUID.test(e.senioridadeId)) erros.push({ campo: 'senioridadeId', mensagem: 'Escolha a senioridade.' });
  if (erros.length > 0) return falha(erros);
  return ok({ minimo: minimo as Dinheiro, maximo: maximo as Dinheiro });
}

// FOR SHARE: trava o cargo e a senioridade contra a inativação concorrente (o UPDATE de `ativa` pega
// FOR NO KEY UPDATE, que espera), senão a faixa entraria ativa sob uma senioridade inativa (E4).
async function conferirReferencias(tx: TxCliente, e: EntradaFaixa): Promise<ErroCampo[]> {
  const erros: ErroCampo[] = [];
  const [cargo] = await tx.$queryRaw<{ ativo: boolean }[]>`SELECT "ativo" FROM "cargo" WHERE "id" = ${e.cargoId}::uuid FOR SHARE`;
  if (!cargo?.ativo) erros.push({ campo: 'cargoId', mensagem: 'O cargo deve existir e estar ativo.' });
  const [s] = await tx.$queryRaw<{ ativa: boolean }[]>`SELECT "ativa" FROM "senioridade" WHERE "id" = ${e.senioridadeId}::uuid FOR SHARE`;
  if (!s?.ativa) erros.push({ campo: 'senioridadeId', mensagem: 'A senioridade deve existir e estar ativa.' });
  return erros;
}

/** REQ_TAB_001 (cad.tabela_salarial:incluir). O par cargo + senioridade pode repetir (RN_TAB_03). */
export async function incluirFaixaSalarial(ctx: ContextoRequisicao, e: EntradaFaixa, deps: Deps = {}): Promise<Resultado<{ id: string }>> {
  exigir(ctx, FUNC, 'incluir');
  const v = validarFaixa(e);
  if (!v.ok) return v;
  return (deps.cliente ?? prisma).$transaction(async (tx: TxCliente) => {
    const erros = await conferirReferencias(tx, e);
    if (erros.length > 0) return falha(erros);
    const f = await tx.faixaSalarial.create({
      data: { cargoId: e.cargoId, senioridadeId: e.senioridadeId, minimo: v.valor.minimo.paraString(), maximo: v.valor.maximo.paraString() },
      select: { id: true },
    });
    await auditar(tx, {
      contexto: contextoDe(ctx),
      funcionalidade: FUNC,
      tipo: 'INSERCAO',
      registroId: f.id,
      descricao: 'Faixa salarial incluída',
      depois: { cargoId: e.cargoId, senioridadeId: e.senioridadeId, minimo: v.valor.minimo, maximo: v.valor.maximo },
    });
    return ok({ id: f.id });
  });
}

/** REQ_TAB_001 (cad.tabela_salarial:alterar), com a versão contra escrita concorrente. */
export async function alterarFaixaSalarial(ctx: ContextoRequisicao, id: string, versao: number, e: EntradaFaixa, deps: Deps = {}): Promise<Resultado<{ versao: number }>> {
  exigir(ctx, FUNC, 'alterar');
  const v = validarFaixa(e);
  if (!v.ok) return v;
  if (!UUID.test(id) || !Number.isInteger(versao)) return falha([{ campo: '_', mensagem: 'Faixa ou versão inválidas. Recarregue a tela.' }]);
  return (deps.cliente ?? prisma).$transaction(async (tx: TxCliente) => {
    const erros = await conferirReferencias(tx, e);
    if (erros.length > 0) return falha(erros);
    const antes = await tx.faixaSalarial.findUnique({ where: { id } });
    const r = await tx.faixaSalarial.updateMany({
      where: { id, versao, ativa: true },
      data: { cargoId: e.cargoId, senioridadeId: e.senioridadeId, minimo: v.valor.minimo.paraString(), maximo: v.valor.maximo.paraString(), versao: { increment: 1 } },
    });
    if (r.count === 0 || !antes) return falha([{ campo: '_', mensagem: MSG_CONCORRENCIA }]);
    await auditar(tx, {
      contexto: contextoDe(ctx),
      funcionalidade: FUNC,
      tipo: 'ALTERACAO',
      registroId: id,
      descricao: 'Faixa salarial alterada',
      antes: { cargoId: antes.cargoId, senioridadeId: antes.senioridadeId, minimo: antes.minimo.toFixed(2), maximo: antes.maximo.toFixed(2) },
      depois: { cargoId: e.cargoId, senioridadeId: e.senioridadeId, minimo: v.valor.minimo, maximo: v.valor.maximo },
    });
    return ok({ versao: versao + 1 });
  });
}

/** A exclusão da faixa é inativação (cad.tabela_salarial:excluir). */
export async function inativarFaixaSalarial(ctx: ContextoRequisicao, id: string, versao: number, deps: Deps = {}): Promise<Resultado<void>> {
  exigir(ctx, FUNC, 'excluir');
  if (!UUID.test(id) || !Number.isInteger(versao)) return falha([{ campo: '_', mensagem: 'Faixa ou versão inválidas. Recarregue a tela.' }]);
  return (deps.cliente ?? prisma).$transaction(async (tx: TxCliente) => {
    const r = await tx.faixaSalarial.updateMany({ where: { id, versao, ativa: true }, data: { ativa: false, versao: { increment: 1 } } });
    if (r.count === 0) return falha([{ campo: '_', mensagem: MSG_CONCORRENCIA }]);
    const f = await tx.faixaSalarial.findUnique({ where: { id }, select: { cargoId: true, senioridadeId: true } });
    await auditar(tx, {
      contexto: contextoDe(ctx),
      funcionalidade: FUNC,
      tipo: 'ALTERACAO',
      registroId: id,
      descricao: 'Faixa salarial inativada',
      antes: { ativa: true, cargoId: f?.cargoId, senioridadeId: f?.senioridadeId },
      depois: { ativa: false },
    });
    return ok(undefined);
  });
}

/** RN_TAB_01: a GRH cadastra novos níveis (cad.tabela_salarial:incluir). */
export async function incluirSenioridade(ctx: ContextoRequisicao, nome: string, deps: Deps = {}): Promise<Resultado<{ id: string; nome: string; reativada: boolean }>> {
  exigir(ctx, FUNC, 'incluir');
  const n = nome.trim();
  if (n.length < 1 || n.length > 40 || /[\p{Cc}\p{Cf}]/u.test(n)) return falha([{ campo: 'nome', mensagem: 'Informe o nome da senioridade, com até 40 caracteres.' }]);
  return (deps.cliente ?? prisma).$transaction(async (tx: TxCliente) => {
    const existe = await tx.senioridade.findFirst({ where: { nome: { equals: n, mode: 'insensitive' } }, select: { id: true, ativa: true, nome: true } });
    if (existe?.ativa) return falha([{ campo: 'nome', mensagem: 'Já existe uma senioridade com esse nome.' }]);
    // A inativa do mesmo nome volta (o nome é único sem diferenciar maiúsculas).
    if (existe) {
      await tx.senioridade.update({ where: { id: existe.id }, data: { ativa: true } });
      await auditar(tx, { contexto: contextoDe(ctx), funcionalidade: FUNC, tipo: 'ALTERACAO', registroId: existe.id, descricao: `Senioridade ${existe.nome} reativada`, antes: { ativa: false }, depois: { ativa: true } });
      return ok({ id: existe.id, nome: existe.nome, reativada: true });
    }
    const s = await tx.senioridade.create({ data: { nome: n }, select: { id: true } });
    await auditar(tx, { contexto: contextoDe(ctx), funcionalidade: FUNC, tipo: 'INSERCAO', registroId: s.id, descricao: `Senioridade ${n} incluída`, depois: { nome: n } });
    return ok({ id: s.id, nome: n, reativada: false });
  });
}

/** RN_TAB_01 e E4: as padrão não se inativam; a customizada, só sem faixa ativa (cad.tabela_salarial:excluir). */
export async function inativarSenioridade(ctx: ContextoRequisicao, id: string, deps: Deps = {}): Promise<Resultado<void>> {
  exigir(ctx, FUNC, 'excluir');
  if (!UUID.test(id)) return falha([{ campo: '_', mensagem: 'Senioridade inválida. Recarregue a tela.' }]);
  return (deps.cliente ?? prisma).$transaction(async (tx: TxCliente) => {
    // FOR UPDATE: espera a inclusão de faixa que travou a senioridade, e a contagem abaixo já a vê
    // (a mensagem amigável, em vez do erro do trigger).
    await tx.$queryRaw`SELECT 1 FROM "senioridade" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const s = await tx.senioridade.findUnique({ where: { id } });
    if (!s || !s.ativa) return falha([{ campo: '_', mensagem: 'Senioridade não encontrada ou já inativa. Recarregue a tela.' }]);
    if (s.padrao) return falha([{ campo: '_', mensagem: MSG_SENIORIDADE_PADRAO }]);
    if (await tx.faixaSalarial.count({ where: { senioridadeId: id, ativa: true } })) return falha([{ campo: '_', mensagem: MSG_SENIORIDADE_COM_FAIXA }]);
    await tx.senioridade.update({ where: { id }, data: { ativa: false } });
    await auditar(tx, { contexto: contextoDe(ctx), funcionalidade: FUNC, tipo: 'ALTERACAO', registroId: id, descricao: `Senioridade ${s.nome} inativada`, antes: { ativa: true }, depois: { ativa: false } });
    return ok(undefined);
  });
}

/**
 * REQ_TAB_003/005, RN_TAB_04: copia o mínimo e o máximo da faixa para o cargo, com o indicador
 * "Preenchido via Tabela Salarial — <cargo>/<senioridade>" (cad.cargos:alterar e cad.salarios, como a
 * alteração do cargo). A edição manual depois troca o indicador para "Editado manualmente".
 */
export async function copiarFaixaParaCargo(
  ctx: ContextoRequisicao,
  cargoId: string,
  faixaId: string,
  versaoFaixa: number,
  versao: number,
  deps: Deps = {},
): Promise<Resultado<{ versao: number }>> {
  exigir(ctx, 'cad.cargos', 'alterar');
  exigir(ctx, 'cad.salarios', 'consultar');
  exigir(ctx, FUNC, 'consultar');
  if (!UUID.test(cargoId) || !UUID.test(faixaId) || !Number.isInteger(versao) || !Number.isInteger(versaoFaixa)) {
    return falha([{ campo: '_', mensagem: 'Cargo, faixa ou versão inválidos. Recarregue a tela.' }]);
  }
  return (deps.cliente ?? prisma).$transaction(async (tx: TxCliente) => {
    // A faixa que o usuário viu (versão), travada contra a alteração ou inativação concorrente.
    const [travada] = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "faixa_salarial" WHERE "id" = ${faixaId}::uuid AND "versao" = ${versaoFaixa} AND "ativa" FOR SHARE`;
    const f = travada
      ? await tx.faixaSalarial.findUnique({ where: { id: faixaId }, include: { senioridade: { select: { nome: true } }, cargo: { select: { nomeOficial: true } } } })
      : null;
    if (!f) return falha([{ campo: '_', mensagem: 'A faixa mudou ou foi inativada. Recarregue a tela.' }]);
    if (f.cargoId !== cargoId) return falha([{ campo: '_', mensagem: 'A faixa deve ser do mesmo cargo.' }]);
    const antes = await tx.cargo.findUnique({ where: { id: cargoId }, select: { codigo: true, mercadoMinimo: true, mercadoMaximo: true, origemMercadoRotulo: true } });
    const rotulo = `Preenchido via Tabela Salarial — ${f.cargo.nomeOficial}/${f.senioridade.nome}`;
    const r = await tx.cargo.updateMany({
      where: { id: cargoId, versao },
      data: { mercadoMinimo: f.minimo, mercadoMaximo: f.maximo, origemMercado: 'TABELA_SALARIAL', origemMercadoRotulo: rotulo, versao: { increment: 1 } },
    });
    if (r.count === 0 || !antes) return falha([{ campo: '_', mensagem: MSG_CONCORRENCIA }]);
    await auditar(tx, {
      contexto: contextoDe(ctx),
      funcionalidade: 'cad.cargos',
      tipo: 'ALTERACAO',
      registroId: antes.codigo,
      descricao: `Mercado do cargo ${antes.codigo} preenchido pela tabela salarial`,
      antes: { mercadoMinimo: antes.mercadoMinimo?.toFixed(2) ?? null, mercadoMaximo: antes.mercadoMaximo?.toFixed(2) ?? null, origemMercado: antes.origemMercadoRotulo },
      depois: { mercadoMinimo: f.minimo.toFixed(2), mercadoMaximo: f.maximo.toFixed(2), origemMercado: rotulo },
    });
    return ok({ versao: versao + 1 });
  });
}
