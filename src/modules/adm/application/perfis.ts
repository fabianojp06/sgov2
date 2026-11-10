import { z } from 'zod';
import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { auditar, type ContextoAuditoria } from '@/shared/audit';
import { exigir, type Acao, type ContextoRequisicao } from '@/shared/authz';
import { prisma, travarRecurso, type TxCliente } from '@/shared/db';
import { ErroDominio, exigirUmaLinha, falha, ok, type Resultado } from '@/shared/kernel';
import {
  conferirPermissoes,
  DESCRICOES_PERFIL,
  diferencaPermissoes,
  funcionalidadesDaGrade,
  MENSAGENS_PERFIL,
  mudouPermissoes,
  ordenarMapa,
  retratoPerfil,
  temFuncionalidadeAtiva,
  validarPerfil,
  type AcaoPerfil,
  type DiferencaPermissoes,
  type FuncionalidadeCatalogo,
  type MapaPermissoes,
} from '../domain/perfil';
import { ehFixaDoAdministrador, ehPerfilDaTela, gerarCodigoPerfil, PREFIXO_PERFIL_TELA } from '../domain/perfis';

// Cadastro de perfis e permissões (US-037; EP085 UC02.07–10 e UC02.25/26 como um caso de uso só;
// plano do P13). Exclusivo do Administrador. Cada caso de uso chama exigir primeiro e roda numa
// transação só, com perfil, permissões e Histórico juntos (RNF0002). As permissões continuam lidas
// por requisição em carregarPermissoes (login.ts), que alimenta menu, guarda e Histórico.
export type DepsPerfis = { cliente: PrismaClient };

const FUNCIONALIDADE = 'adm.perfis';

// O domínio repete a lista de ações do C5; aqui o compilador confere que as duas são a mesma.
type Mesma<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _acoesDoC5: Mesma<Acao, AcaoPerfil> = true;
void _acoesDoC5;

// O perfil não é por TP: o Histórico sai sem unidade.
const contextoAuditoria = (ctx: ContextoRequisicao): ContextoAuditoria => ({
  usuarioId: ctx.usuarioId,
  usuarioRotulo: ctx.usuarioRotulo,
  sessaoUid: ctx.sessaoUid,
  ip: ctx.ip,
  unidadeId: null,
});

const idValido = (id: string) => z.uuid().safeParse(id).success;
const inexistente = () => new ErroDominio('adm.perfil_inexistente', MENSAGENS_PERFIL.INEXISTENTE);
const recusa = (campo: string, mensagem: string) => falha([{ campo, mensagem }]);
const alterado = () => recusa('_', MENSAGENS_PERFIL.ALTERADO);
const nomeDuplicado = () => recusa('nome', MENSAGENS_PERFIL.NOME_DUPLICADO);
const comUsuarios = () => recusa('_', MENSAGENS_PERFIL.COM_USUARIOS);
const codigoErro = (erro: unknown) => (erro instanceof Prisma.PrismaClientKnownRequestError ? erro.code : undefined);

// Catálogo inteiro, na ordem do menu (módulo, funcionalidade). `ativa` soma o status do módulo (RN0078).
type FuncionalidadeLida = FuncionalidadeCatalogo & { grupo: string; moduloNome: string; moduloAtivo: boolean };

async function carregarCatalogo(tx: TxCliente): Promise<FuncionalidadeLida[]> {
  const fs = await tx.funcionalidade.findMany({
    include: { modulo: { select: { nome: true, ativo: true } } },
    orderBy: [{ modulo: { ordem: 'asc' } }, { ordem: 'asc' }, { codigo: 'asc' }],
  });
  return fs.map((f) => ({
    codigo: f.codigo,
    nome: f.nome,
    modulo: f.moduloCodigo,
    acoes: f.acoes,
    ativa: f.ativo && f.modulo.ativo,
    grupo: f.grupo,
    moduloNome: f.modulo.nome,
    moduloAtivo: f.modulo.ativo,
  }));
}

async function permissoesDoPerfil(tx: TxCliente, perfilId: string): Promise<MapaPermissoes> {
  const linhas = await tx.perfilPermissao.findMany({ where: { perfilId }, select: { funcionalidadeCodigo: true, acao: true } });
  const mapa: Record<string, AcaoPerfil[]> = {};
  for (const l of linhas) (mapa[l.funcionalidadeCodigo] ??= []).push(l.acao as AcaoPerfil);
  return mapa;
}

// RN0068: único sem diferenciar maiúsculas, fora o próprio registro. A corrida fica com o índice
// perfil_nome_ci_key (P2002), que devolve a mesma mensagem.
async function nomeEmUso(tx: TxCliente, nome: string, foraDe?: string): Promise<boolean> {
  const outro = foraDe === undefined ? Prisma.empty : Prisma.sql`AND id <> ${foraDe}::uuid`;
  const [r] = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM perfil WHERE lower(nome) = lower(${nome}) ${outro}`;
  return (r?.n ?? 0) > 0;
}

// Código do perfil criado pela tela (D-P13-2): colisão vira nova tentativa, até 3.
async function codigoLivre(tx: TxCliente): Promise<string> {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const codigo = gerarCodigoPerfil();
    if (!(await tx.perfil.findUnique({ where: { codigo }, select: { id: true } }))) return codigo;
  }
  throw new ErroDominio('adm.perfil_codigo', 'Não foi possível gerar o código do perfil. Tente novamente.');
}

// Aplica o diff às linhas de perfil_permissao (só as funcionalidades da grade).
async function gravarPermissoes(tx: TxCliente, perfilId: string, d: DiferencaPermissoes): Promise<void> {
  const retiradas = d.retiradas.map((r) => r.funcionalidade);
  if (retiradas.length > 0) await tx.perfilPermissao.deleteMany({ where: { perfilId, funcionalidadeCodigo: { in: retiradas } } });
  const novas: { perfilId: string; funcionalidadeCodigo: string; acao: string }[] = [];
  for (const a of d.associadas) for (const acao of a.acoes) novas.push({ perfilId, funcionalidadeCodigo: a.funcionalidade, acao });
  for (const m of d.alteradas) {
    const sairam = m.antes.filter((x) => !m.depois.includes(x));
    if (sairam.length > 0) await tx.perfilPermissao.deleteMany({ where: { perfilId, funcionalidadeCodigo: m.funcionalidade, acao: { in: [...sairam] } } });
    for (const acao of m.depois.filter((x) => !m.antes.includes(x))) novas.push({ perfilId, funcionalidadeCodigo: m.funcionalidade, acao });
  }
  if (novas.length > 0) await tx.perfilPermissao.createMany({ data: novas });
}

// Uma entrada por associação criada ou retirada (RN0081) e por funcionalidade com as ações mudadas (RN0080).
async function auditarPermissoes(
  tx: TxCliente,
  contexto: ContextoAuditoria,
  registroId: string,
  nomePerfil: string,
  nomeFuncionalidade: (codigo: string) => string,
  d: DiferencaPermissoes,
): Promise<void> {
  const base = { contexto, funcionalidade: FUNCIONALIDADE, registroId };
  for (const a of d.associadas) {
    await auditar(tx, { ...base, tipo: 'INSERCAO', descricao: DESCRICOES_PERFIL.associada(nomeFuncionalidade(a.funcionalidade), nomePerfil), depois: { funcionalidade: a.funcionalidade, acoes: [...a.acoes] } });
  }
  for (const r of d.retiradas) {
    await auditar(tx, { ...base, tipo: 'EXCLUSAO', descricao: DESCRICOES_PERFIL.retirada(nomeFuncionalidade(r.funcionalidade), nomePerfil), antes: { funcionalidade: r.funcionalidade, acoes: [...r.acoes] } });
  }
  for (const m of d.alteradas) {
    await auditar(tx, {
      ...base,
      tipo: 'ALTERACAO',
      descricao: DESCRICOES_PERFIL.acoes(nomeFuncionalidade(m.funcionalidade), nomePerfil),
      antes: { funcionalidade: m.funcionalidade, acoes: [...m.antes] },
      depois: { funcionalidade: m.funcionalidade, acoes: [...m.depois] },
    });
  }
}

const nomes = (catalogo: readonly FuncionalidadeLida[]) => {
  const porCodigo = new Map(catalogo.map((f) => [f.codigo, f.nome]));
  return (codigo: string) => porCodigo.get(codigo) ?? codigo;
};
const ativasDe = (catalogo: readonly FuncionalidadeLida[]) => new Set(catalogo.filter((f) => f.ativa).map((f) => f.codigo));

export type LinhaPerfil = {
  id: string;
  codigo: string;
  nome: string;
  descricao: string;
  ativo: boolean;
  padrao: boolean;
  usuarios: number;
  usuariosAtivos: number;
  versao: number;
};

// UC02.07: lista com Nome, Descrição e Status (REQ0069) e, a mais, a quantidade de usuários.
export async function listarPerfis(ctx: ContextoRequisicao, deps: Partial<DepsPerfis> = {}): Promise<LinhaPerfil[]> {
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const cliente = deps.cliente ?? prisma;
  const perfis = await cliente.perfil.findMany({
    select: { id: true, codigo: true, nome: true, descricao: true, ativo: true, versao: true, usuarios: { select: { usuario: { select: { ativo: true } } } } },
    orderBy: [{ nome: 'asc' }, { codigo: 'asc' }],
  });
  return perfis.map(({ usuarios, ...p }) => ({
    ...p,
    padrao: !ehPerfilDaTela(p.codigo),
    usuarios: usuarios.length,
    usuariosAtivos: usuarios.filter((u) => u.usuario.ativo).length,
  }));
}

export type DetalhePerfil = {
  id: string;
  codigo: string;
  nome: string;
  descricao: string;
  ativo: boolean;
  padrao: boolean;
  administrador: boolean;
  usuariosAtivos: number;
  versao: number;
  permissoes: { funcionalidade: string; acoes: AcaoPerfil[] }[];
};

// UC02.26: dados do formulário de alteração (a versão volta na gravação).
export async function obterPerfil(ctx: ContextoRequisicao, id: string, deps: Partial<DepsPerfis> = {}): Promise<DetalhePerfil | null> {
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  if (!idValido(id)) return null;
  const cliente = deps.cliente ?? prisma;
  const p = await cliente.perfil.findUnique({
    where: { id },
    select: { id: true, codigo: true, nome: true, descricao: true, ativo: true, versao: true, usuarios: { where: { usuario: { ativo: true } }, select: { usuarioId: true } } },
  });
  if (!p) return null;
  const mapa = await permissoesDoPerfil(cliente, id);
  const { usuarios, ...dados } = p;
  return {
    ...dados,
    padrao: !ehPerfilDaTela(p.codigo),
    administrador: p.codigo === 'ADMINISTRADOR',
    usuariosAtivos: usuarios.length,
    permissoes: Object.entries(ordenarMapa(mapa)).map(([funcionalidade, acoes]) => ({ funcionalidade, acoes: [...acoes] })),
  };
}

export type FuncionalidadeDaGrade = { codigo: string; nome: string; grupo: string; acoes: AcaoPerfil[]; fixas: AcaoPerfil[] };
export type ModuloDaGrade = { modulo: string; nome: string; funcionalidades: FuncionalidadeDaGrade[] };

// Seção "Definição de Permissões de Acesso" (D-P13-12): por módulo ativo, as funcionalidades da grade
// do perfil (D-P13-6, A1). No Administrador, as da Administração vêm com as ações fixas (marcadas e
// desabilitadas, D-P13-4, A2). perfilCodigo null: cadastro (perfil da tela, sem a Administração).
export async function gradePermissoes(ctx: ContextoRequisicao, perfilCodigo: string | null, deps: Partial<DepsPerfis> = {}): Promise<ModuloDaGrade[]> {
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const cliente = deps.cliente ?? prisma;
  const codigo = perfilCodigo ?? PREFIXO_PERFIL_TELA;
  const catalogo = await carregarCatalogo(cliente);
  const daGrade = new Set(funcionalidadesDaGrade(codigo, catalogo).map((f) => f.codigo));
  let fixas: MapaPermissoes = {};
  if (codigo === 'ADMINISTRADOR') {
    const perfil = await cliente.perfil.findUnique({ where: { codigo }, select: { id: true } });
    fixas = perfil ? await permissoesDoPerfil(cliente, perfil.id) : {};
  }
  const modulos: ModuloDaGrade[] = [];
  for (const f of catalogo) {
    const fixa = ehFixaDoAdministrador(codigo, f.codigo, f.modulo) && f.ativa && (fixas[f.codigo]?.length ?? 0) > 0;
    if (!daGrade.has(f.codigo) && !fixa) continue;
    let modulo = modulos.at(-1);
    if (modulo?.modulo !== f.modulo) {
      modulo = { modulo: f.modulo, nome: f.moduloNome, funcionalidades: [] };
      modulos.push(modulo);
    }
    const acoes = f.acoes as AcaoPerfil[];
    modulo.funcionalidades.push({ codigo: f.codigo, nome: f.nome, grupo: f.grupo, acoes, fixas: fixa ? acoes.filter((a) => fixas[f.codigo]!.includes(a)) : [] });
  }
  return modulos;
}

// UC02.25: cadastro. O código é gerado (D-P13-2); a Administração nunca entra (D-P13-4).
export async function incluirPerfil(ctx: ContextoRequisicao, entrada: unknown, deps: Partial<DepsPerfis> = {}): Promise<Resultado<{ id: string }>> {
  exigir(ctx, FUNCIONALIDADE, 'incluir');
  const cliente = deps.cliente ?? prisma;
  const v = validarPerfil(entrada);
  if (!v.ok) return v;
  const p = v.valor;
  const contexto = contextoAuditoria(ctx);
  try {
    return await cliente.$transaction(async (tx) => {
      const catalogo = await carregarCatalogo(tx);
      const codigo = await codigoLivre(tx);
      const conferidas = conferirPermissoes(codigo, p.permissoes, p.exibidas, catalogo);
      if (!conferidas.ok) return conferidas;
      const d = diferencaPermissoes({}, p.permissoes, conferidas.valor.grade);
      // RN0082 (E2).
      if (!temFuncionalidadeAtiva(d.final, ativasDe(catalogo))) return recusa('permissoes', MENSAGENS_PERFIL.SEM_FUNCIONALIDADE);
      if (await nomeEmUso(tx, p.nome)) return nomeDuplicado();
      const { id } = await tx.perfil.create({ data: { codigo, nome: p.nome, descricao: p.descricao, ativo: p.ativo }, select: { id: true } });
      await gravarPermissoes(tx, id, d);
      await auditar(tx, {
        contexto,
        funcionalidade: FUNCIONALIDADE,
        tipo: 'INSERCAO',
        registroId: id,
        descricao: DESCRICOES_PERFIL.cadastrado(p.nome),
        depois: retratoPerfil({ ...p, permissoes: d.final }),
      });
      await auditarPermissoes(tx, contexto, id, p.nome, nomes(catalogo), d);
      return ok({ id });
    });
  } catch (erro) {
    // Dois cadastros simultâneos com o mesmo nome: o índice perfil_nome_ci_key decide (RN0068).
    if (codigoErro(erro) === 'P2002') return nomeDuplicado();
    throw erro;
  }
}

// UC02.26: alteração de nome, descrição, status e permissões. Mudar permissões ou status derruba as
// sessões dos usuários do perfil, menos a de quem salvou (RN0040, D-P13-7). Sem confirmação, inativar
// com usuários ativos devolve o pedido do E3 e não grava (D-P13-10).
export async function alterarPerfil(
  ctx: ContextoRequisicao,
  id: string,
  versao: number,
  entrada: unknown,
  deps: Partial<DepsPerfis> = {},
): Promise<Resultado<void | { confirmar: string }>> {
  exigir(ctx, FUNCIONALIDADE, 'alterar');
  const cliente = deps.cliente ?? prisma;
  if (!idValido(id)) throw inexistente();
  const v = validarPerfil(entrada);
  if (!v.ok) return v;
  const p = v.valor;
  const contexto = contextoAuditoria(ctx);
  try {
    return await cliente.$transaction((tx) => gravar(tx));
  } catch (erro) {
    if (codigoErro(erro) === 'P2002') return nomeDuplicado();
    throw erro;
  }

  async function gravar(tx: TxCliente): Promise<Resultado<void | { confirmar: string }>> {
    // A mesma trava do cadastro de usuários, antes da linha do perfil: o alterarUsuario trava o usuário
    // e depois o vínculo com o perfil (FOR KEY SHARE), e aqui a queda das sessões trava os usuários
    // depois do perfil; sem a ordem comum, os dois poderiam se esperar (impasse).
    await travarRecurso(tx, 'adm:administradores');
    // A linha do perfil fica presa até o fim: dois salvamentos com a mesma versão, um grava e o outro
    // recebe o conflito (D-P13-8). No READ COMMITTED, o FOR UPDATE relê a versão depois da espera.
    const [atual] = await tx.$queryRaw<{ codigo: string; nome: string; descricao: string; ativo: boolean; versao: number }[]>`
      SELECT codigo, nome, descricao, ativo, versao FROM perfil WHERE id = ${id}::uuid FOR UPDATE`;
    if (!atual) throw inexistente();
    if (atual.versao !== versao) return alterado();
    // D-P13-4: o Administrador nunca fica inativo (break-glass, RN_SEED_003).
    if (atual.codigo === 'ADMINISTRADOR' && !p.ativo) return recusa('ativo', MENSAGENS_PERFIL.ADMINISTRADOR_INATIVO);
    const catalogo = await carregarCatalogo(tx);
    const conferidas = conferirPermissoes(atual.codigo, p.permissoes, p.exibidas, catalogo);
    if (!conferidas.ok) return conferidas;
    const permissoesAntes = await permissoesDoPerfil(tx, id);
    const d = diferencaPermissoes(permissoesAntes, p.permissoes, conferidas.valor.grade);
    const mudaramPermissoes = mudouPermissoes(d);
    // RN0082 (E2) só quando as permissões mudam (ajuste A7).
    if (mudaramPermissoes && !temFuncionalidadeAtiva(d.final, ativasDe(catalogo))) return recusa('permissoes', MENSAGENS_PERFIL.SEM_FUNCIONALIDADE);
    const antes = retratoPerfil({ ...atual, permissoes: permissoesAntes });
    const depois = retratoPerfil({ ...p, permissoes: d.final });
    // Salvar sem mudança nenhuma não grava nem audita.
    if (JSON.stringify(antes) === JSON.stringify(depois)) return ok(undefined);
    if (await nomeEmUso(tx, p.nome, id)) return nomeDuplicado();
    const inativando = atual.ativo && !p.ativo;
    if (inativando && p.confirmarInativacao !== true) {
      const ativos = await tx.usuarioPerfil.count({ where: { perfilId: id, usuario: { ativo: true } } });
      if (ativos > 0) return ok({ confirmar: MENSAGENS_PERFIL.CONFIRMAR_INATIVACAO });
    }
    exigirUmaLinha(await tx.perfil.updateMany({ where: { id, versao }, data: { nome: p.nome, descricao: p.descricao, ativo: p.ativo, versao: { increment: 1 } } }));
    await gravarPermissoes(tx, id, d);
    // RN0040 (D-P13-7): só a versão de acesso, nunca a `versao` do usuário (sem conflito falso na tela
    // de usuários). Mudar só nome ou descrição não derruba ninguém.
    if (mudaramPermissoes || atual.ativo !== p.ativo) {
      await tx.usuario.updateMany({ where: { id: { not: ctx.usuarioId }, perfis: { some: { perfilId: id } } }, data: { acessoVersao: { increment: 1 } } });
    }
    await auditar(tx, {
      contexto,
      funcionalidade: FUNCIONALIDADE,
      tipo: 'ALTERACAO',
      registroId: id,
      descricao: inativando ? DESCRICOES_PERFIL.inativado(p.nome) : DESCRICOES_PERFIL.alterado(p.nome),
      antes,
      depois,
    });
    await auditarPermissoes(tx, contexto, id, p.nome, nomes(catalogo), d);
    return ok(undefined);
  }
}

// UC02.09/UC02.26 E3 e RN0072: só o perfil criado pela tela (D-P13-3) e sem nenhum usuário associado,
// ativo ou inativo. A linha do perfil fica presa: uma associação feita ao mesmo tempo espera (a FK do
// usuario_perfil pede FOR KEY SHARE) e falha na FK depois do commit; se a exclusão perder a corrida, a
// FK recusa o DELETE (P2003), com a mesma mensagem (D-P13-10).
export async function excluirPerfil(ctx: ContextoRequisicao, id: string, versao: number, deps: Partial<DepsPerfis> = {}): Promise<Resultado<void>> {
  exigir(ctx, FUNCIONALIDADE, 'excluir');
  const cliente = deps.cliente ?? prisma;
  if (!idValido(id)) throw inexistente();
  const contexto = contextoAuditoria(ctx);
  try {
    return await cliente.$transaction(async (tx) => {
      const [atual] = await tx.$queryRaw<{ codigo: string; nome: string; descricao: string; ativo: boolean; versao: number }[]>`
        SELECT codigo, nome, descricao, ativo, versao FROM perfil WHERE id = ${id}::uuid FOR UPDATE`;
      if (!atual) throw inexistente();
      if (atual.versao !== versao) return alterado();
      if (!ehPerfilDaTela(atual.codigo)) return recusa('_', MENSAGENS_PERFIL.PADRAO_EXCLUSAO);
      if ((await tx.usuarioPerfil.count({ where: { perfilId: id } })) > 0) return comUsuarios();
      const permissoes = await permissoesDoPerfil(tx, id);
      await tx.perfilPermissao.deleteMany({ where: { perfilId: id } });
      exigirUmaLinha(await tx.perfil.deleteMany({ where: { id, versao } }));
      await auditar(tx, {
        contexto,
        funcionalidade: FUNCIONALIDADE,
        tipo: 'EXCLUSAO',
        registroId: id,
        descricao: DESCRICOES_PERFIL.excluido(atual.nome),
        antes: retratoPerfil({ ...atual, permissoes }),
      });
      return ok(undefined);
    });
  } catch (erro) {
    if (codigoErro(erro) === 'P2003') return comUsuarios();
    throw erro;
  }
}
