import { z } from 'zod';
import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { enviarEmail } from '@/modules/ger';
import { auditar, type ContextoAuditoria } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { lerEnvAcesso } from '@/shared/config';
import { prisma, type TxCliente } from '@/shared/db';
import { ErroDominio, falha, ok, type Resultado } from '@/shared/kernel';
import { MENSAGENS_USUARIO, perdeUltimoAdministrador, validarUsuario, type UsuarioValidado } from '../domain/usuario';
import { gerarSenhaTemporaria } from '../infrastructure/gerar-senha';
import { hashSenha } from '../infrastructure/senha-argon2';
import { obterConfiguracaoAcesso } from './configuracao';

// Casos de uso de usuário (UC02.11 a UC02.14, UC02.18; US-038). Cada um chama exigir primeiro e
// roda numa transação só, com o Histórico e o e-mail (contrato C4) no mesmo tx: se a auditoria ou
// o registro do e-mail falhar, nada é gravado. O Argon2 da senha temporária roda antes, fora dela.
export type DepsAdm = { cliente: PrismaClient; agora: () => Date; enviarEmail: typeof enviarEmail };

const FUNCIONALIDADE = 'adm.usuarios';

function resolver(deps: Partial<DepsAdm>): DepsAdm {
  return { cliente: deps.cliente ?? prisma, agora: deps.agora ?? (() => new Date()), enviarEmail: deps.enviarEmail ?? enviarEmail };
}

const contextoAuditoria = (ctx: ContextoRequisicao): ContextoAuditoria => ({
  usuarioId: ctx.usuarioId,
  usuarioRotulo: ctx.usuarioRotulo,
  sessaoUid: ctx.sessaoUid,
  ip: ctx.ip,
  unidadeId: ctx.unidadeId ?? null,
});

// O que vai ao Histórico: os dados do formulário, nunca senha ou hash.
const retrato = (u: Omit<UsuarioValidado, 'loginNormalizado'>) => ({
  nome: u.nome,
  email: u.email,
  login: u.login,
  ativo: u.ativo,
  perfis: [...u.perfis].sort(),
  unidades: [...u.unidades].sort(),
  ccEscopo: u.ccEscopo,
});

const ehLoginDuplicado = (erro: unknown) => erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002';
const loginDuplicado = () => falha([{ campo: 'login', mensagem: MENSAGENS_USUARIO.LOGIN_DUPLICADO }]);
const alterado = () => falha([{ campo: '_', mensagem: MENSAGENS_USUARIO.ALTERADO }]);

// Serializa as mudanças que podem tirar o último Administrador ativo. Depende do READ COMMITTED
// (padrão do projeto): cada comando depois da trava enxerga o que a transação anterior gravou. Sob
// REPEATABLE READ ou SERIALIZABLE, o snapshot seria o de antes da espera e a contagem erraria.
const travarAdministradores = (tx: TxCliente) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('adm:administradores'))`;

type Perfil = { id: string; codigo: string; nome: string };

// O id vem da URL ou do formulário: fora do formato uuid, é um usuário que não existe (o banco
// recusaria o valor com erro de tipo, e a tela cairia no erro genérico).
const idValido = (id: string) => z.uuid().safeParse(id).success;
const inexistente = () => new ErroDominio('adm.usuario_inexistente', MENSAGENS_USUARIO.INEXISTENTE);

// Perfis e unidades precisam existir (RN0079) e, quando novos, estar ativos. Um vínculo que já
// existia e foi inativado depois não impede alterar o resto do cadastro.
async function resolverVinculos(
  tx: TxCliente,
  u: UsuarioValidado,
  atuais: { perfis: readonly string[]; unidades: readonly string[] } = { perfis: [], unidades: [] },
): Promise<Resultado<{ perfis: Perfil[] }>> {
  const perfis = await tx.perfil.findMany({ where: { codigo: { in: [...u.perfis] } }, select: { id: true, codigo: true, nome: true, ativo: true } });
  const perfilAceito = (codigo: string) => perfis.some((p) => p.codigo === codigo && (p.ativo || atuais.perfis.includes(codigo)));
  if (!u.perfis.every(perfilAceito)) return falha([{ campo: 'perfis', mensagem: MENSAGENS_USUARIO.PERFIL_INVALIDO }]);
  const novas = u.unidades.filter((x) => !atuais.unidades.includes(x));
  const existentes = u.unidades.length === 0 ? [] : await tx.unidade.findMany({ where: { id: { in: [...u.unidades] } }, select: { id: true, ativo: true } });
  const unidadeAceita = (id: string) => existentes.some((x) => x.id === id && (x.ativo || !novas.includes(id)));
  if (!u.unidades.every(unidadeAceita)) return falha([{ campo: 'unidades', mensagem: MENSAGENS_USUARIO.UNIDADE_INVALIDA }]);
  // Ordem do catálogo (CODIGOS_PERFIL) para o Histórico sair estável.
  return ok({ perfis: u.perfis.map((codigo) => perfis.find((p) => p.codigo === codigo)!) });
}

async function senhaTemporaria(cliente: PrismaClient, agora: Date) {
  const config = await obterConfiguracaoAcesso(cliente);
  const senha = gerarSenhaTemporaria(config.politica);
  return { senha, hash: await hashSenha(senha), expiraEm: new Date(agora.getTime() + config.senhaTemporariaHoras * 3600_000) };
}

const urlAcesso = () => `${lerEnvAcesso().urlPublica}/login`;

// UC02.12: cadastro com senha gerada pelo sistema e enviada por e-mail (RN0059, RN0071).
export async function cadastrarUsuario(ctx: ContextoRequisicao, entrada: unknown, deps: Partial<DepsAdm> = {}): Promise<Resultado<{ id: string }>> {
  exigir(ctx, FUNCIONALIDADE, 'incluir');
  const { cliente, agora, enviarEmail: enviar } = resolver(deps);
  const v = validarUsuario(entrada);
  if (!v.ok) return v;
  const u = v.valor;
  const senha = await senhaTemporaria(cliente, agora());
  const contexto = contextoAuditoria(ctx);
  try {
    return await cliente.$transaction(async (tx) => {
      if (await tx.usuario.findUnique({ where: { loginNormalizado: u.loginNormalizado }, select: { id: true } })) return loginDuplicado();
      const vinculos = await resolverVinculos(tx, u);
      if (!vinculos.ok) return vinculos;
      const { id } = await tx.usuario.create({
        data: {
          nome: u.nome,
          email: u.email,
          login: u.login,
          loginNormalizado: u.loginNormalizado,
          ativo: u.ativo,
          ccEscopo: u.ccEscopo,
          senhaHash: senha.hash,
          trocaSenhaObrigatoria: true,
          senhaExpiraEm: senha.expiraEm,
          perfis: { create: vinculos.valor.perfis.map((p) => ({ perfilId: p.id })) },
          unidades: { create: u.unidades.map((unidadeId) => ({ unidadeId })) },
        },
        select: { id: true },
      });
      await auditar(tx, { contexto, funcionalidade: FUNCIONALIDADE, tipo: 'INSERCAO', registroId: id, descricao: `Cadastrou o usuário ${u.nome}`, depois: retrato(u) });
      for (const p of vinculos.valor.perfis) {
        await auditar(tx, {
          contexto,
          funcionalidade: FUNCIONALIDADE,
          tipo: 'INSERCAO',
          registroId: id,
          descricao: `Perfil ${p.nome} associado ao usuário ${u.nome}`,
          depois: { perfil: p.codigo },
        });
      }
      await enviar(tx, 'usuario.senha_inicial', { email: u.email, nome: u.nome }, { nome: u.nome, login: u.login, senhaTemporaria: senha.senha, urlAcesso: urlAcesso() });
      return ok({ id });
    });
  } catch (erro) {
    // Dois cadastros simultâneos do mesmo login: o índice único decide (RN0065).
    if (ehLoginDuplicado(erro)) return loginDuplicado();
    throw erro;
  }
}

// UC02.13: alteração. O login vem do banco, nunca da entrada (RN0066). Mudar perfis, status ou CC
// de escopo incrementa o acessoVersao, e as sessões do usuário caem (RN0040).
export async function alterarUsuario(
  ctx: ContextoRequisicao,
  id: string,
  versao: number,
  entrada: Readonly<Record<string, unknown>>,
  deps: Partial<DepsAdm> = {},
): Promise<Resultado<void>> {
  exigir(ctx, FUNCIONALIDADE, 'alterar');
  const { cliente, agora } = resolver(deps);
  if (!idValido(id)) throw inexistente();
  const contexto = contextoAuditoria(ctx);
  return cliente.$transaction(async (tx) => {
    await travarAdministradores(tx);
    const atual = await tx.usuario.findUnique({
      where: { id },
      include: { perfis: { include: { perfil: { select: { codigo: true, nome: true } } } }, unidades: { select: { unidadeId: true } } },
    });
    if (!atual) throw inexistente();
    if (atual.versao !== versao) return alterado();
    const v = validarUsuario({ ...entrada, login: atual.login });
    if (!v.ok) return v;
    const u = v.valor;
    const perfisAntes = atual.perfis.map((p) => p.perfil);
    const codigosAntes = perfisAntes.map((p) => p.codigo);
    const unidadesAntes = atual.unidades.map((x) => x.unidadeId);
    const antes = retrato({ ...atual, perfis: codigosAntes as UsuarioValidado['perfis'], unidades: unidadesAntes });
    // Salvar sem mudança nenhuma não grava nem audita.
    if (JSON.stringify(antes) === JSON.stringify(retrato(u))) return ok(undefined);
    const vinculos = await resolverVinculos(tx, u, { perfis: codigosAntes, unidades: unidadesAntes });
    if (!vinculos.ok) return vinculos;

    // Só conta como outro Administrador quem consegue entrar: ativo, desbloqueado e já fora da senha
    // temporária. Um administrador recém-cadastrado que nunca recebeu ou abriu o e-mail não segura
    // o sistema, e o break-glass (R6) não age enquanto ele existir.
    const outrosAtivos = await tx.usuario.count({
      where: {
        id: { not: id },
        ativo: true,
        bloqueado: false,
        trocaSenhaObrigatoria: false,
        perfis: { some: { perfil: { codigo: 'ADMINISTRADOR', ativo: true } } },
      },
    });
    if (perdeUltimoAdministrador({ ativo: atual.ativo, bloqueado: atual.bloqueado, perfis: codigosAntes }, u, outrosAtivos)) {
      return falha([{ campo: '_', mensagem: MENSAGENS_USUARIO.ULTIMO_ADMINISTRADOR }]);
    }

    const incluidos = vinculos.valor.perfis.filter((p) => !codigosAntes.includes(p.codigo));
    const retirados = perfisAntes.filter((p) => !u.perfis.includes(p.codigo as (typeof u.perfis)[number]));
    const mudouAcesso = incluidos.length > 0 || retirados.length > 0 || atual.ativo !== u.ativo || atual.ccEscopo !== u.ccEscopo;

    const { count } = await tx.usuario.updateMany({
      where: { id, versao },
      data: {
        nome: u.nome,
        email: u.email,
        ativo: u.ativo,
        ccEscopo: u.ccEscopo,
        atualizadoEm: agora(),
        versao: { increment: 1 },
        ...(mudouAcesso ? { acessoVersao: { increment: 1 } } : {}),
      },
    });
    if (count === 0) return alterado();
    if (retirados.length > 0) {
      const ids = vinculos.valor.perfis.map((p) => p.id);
      await tx.usuarioPerfil.deleteMany({ where: { usuarioId: id, perfilId: { notIn: ids } } });
    }
    if (incluidos.length > 0) await tx.usuarioPerfil.createMany({ data: incluidos.map((p) => ({ usuarioId: id, perfilId: p.id })) });
    await tx.usuarioUnidade.deleteMany({ where: { usuarioId: id, unidadeId: { notIn: [...u.unidades] } } });
    const novasUnidades = u.unidades.filter((x) => !unidadesAntes.includes(x));
    if (novasUnidades.length > 0) await tx.usuarioUnidade.createMany({ data: novasUnidades.map((unidadeId) => ({ usuarioId: id, unidadeId })) });

    await auditar(tx, { contexto, funcionalidade: FUNCIONALIDADE, tipo: 'ALTERACAO', registroId: id, descricao: `Alterou o usuário ${u.nome}`, antes, depois: retrato(u) });
    for (const p of incluidos) {
      await auditar(tx, {
        contexto,
        funcionalidade: FUNCIONALIDADE,
        tipo: 'INSERCAO',
        registroId: id,
        descricao: `Perfil ${p.nome} associado ao usuário ${u.nome}`,
        depois: { perfil: p.codigo },
      });
    }
    for (const p of retirados) {
      await auditar(tx, {
        contexto,
        funcionalidade: FUNCIONALIDADE,
        tipo: 'EXCLUSAO',
        registroId: id,
        descricao: `Perfil ${p.nome} desassociado do usuário ${u.nome}`,
        antes: { perfil: p.codigo },
      });
    }
    return ok(undefined);
  });
}

// UC02.13 A2 / UC02.18: nova senha temporária, enviada por e-mail; as sessões abertas caem. Não
// muda a versão do cadastro: o formulário continua aberto (A2, passo 2.5) e o Salvar seguinte não
// pode dar conflito. A própria senha se troca pela troca voluntária, que exige a senha atual.
export async function resetarSenha(ctx: ContextoRequisicao, id: string, deps: Partial<DepsAdm> = {}): Promise<Resultado<void>> {
  exigir(ctx, FUNCIONALIDADE, 'alterar');
  const { cliente, agora, enviarEmail: enviar } = resolver(deps);
  if (!idValido(id)) throw inexistente();
  if (id === ctx.usuarioId) return falha([{ campo: '_', mensagem: MENSAGENS_USUARIO.RESET_PROPRIO }]);
  const senha = await senhaTemporaria(cliente, agora());
  const contexto = contextoAuditoria(ctx);
  return cliente.$transaction(async (tx) => {
    const atual = await tx.usuario.findUnique({ where: { id }, select: { nome: true, email: true, login: true, ativo: true, versao: true, trocaSenhaObrigatoria: true } });
    if (!atual) throw inexistente();
    if (!atual.ativo) return falha([{ campo: '_', mensagem: MENSAGENS_USUARIO.RESET_INATIVO }]);
    const { count } = await tx.usuario.updateMany({
      where: { id, versao: atual.versao },
      data: {
        senhaHash: senha.hash,
        trocaSenhaObrigatoria: true,
        senhaExpiraEm: senha.expiraEm,
        atualizadoEm: agora(),
        acessoVersao: { increment: 1 },
      },
    });
    if (count === 0) return alterado();
    await auditar(tx, {
      contexto,
      funcionalidade: FUNCIONALIDADE,
      tipo: 'ALTERACAO',
      registroId: id,
      descricao: `Gerou nova senha para o usuário ${atual.nome}`,
      // Chaves sem "senha": o Histórico omite as que parecem credencial, e o registro sairia vazio.
      antes: { primeiroAcessoPendente: atual.trocaSenhaObrigatoria },
      depois: { primeiroAcessoPendente: true, temporariaExpiraEm: senha.expiraEm.toISOString() },
    });
    await enviar(tx, 'usuario.senha_redefinida', { email: atual.email, nome: atual.nome }, { nome: atual.nome, login: atual.login, senhaTemporaria: senha.senha, urlAcesso: urlAcesso() });
    return ok(undefined);
  });
}

// UC02.13 A3: só usuário ativo e bloqueado (RN0063); zera o contador (RN0045) e audita (RN0053).
export async function desbloquearUsuario(ctx: ContextoRequisicao, id: string, deps: Partial<DepsAdm> = {}): Promise<Resultado<void>> {
  exigir(ctx, FUNCIONALIDADE, 'alterar');
  const { cliente, agora } = resolver(deps);
  if (!idValido(id)) throw inexistente();
  const contexto = contextoAuditoria(ctx);
  return cliente.$transaction(async (tx) => {
    const atual = await tx.usuario.findUnique({ where: { id }, select: { nome: true, ativo: true, bloqueado: true, tentativasFalhas: true, versao: true } });
    if (!atual) throw inexistente();
    if (!atual.ativo || !atual.bloqueado) return falha([{ campo: '_', mensagem: MENSAGENS_USUARIO.DESBLOQUEIO_INATIVO }]);
    const { count } = await tx.usuario.updateMany({
      where: { id, versao: atual.versao },
      data: { bloqueado: false, tentativasFalhas: 0, atualizadoEm: agora(), versao: { increment: 1 }, acessoVersao: { increment: 1 } },
    });
    if (count === 0) return alterado();
    await auditar(tx, {
      contexto,
      funcionalidade: FUNCIONALIDADE,
      tipo: 'ALTERACAO',
      registroId: id,
      descricao: `Desbloqueou o usuário ${atual.nome}`,
      antes: { bloqueado: true, tentativasFalhas: atual.tentativasFalhas },
      depois: { bloqueado: false, tentativasFalhas: 0 },
    });
    return ok(undefined);
  });
}

export type ItemListaUsuario = { id: string; nome: string; login: string; ativo: boolean; bloqueado: boolean };

// UC02.11: listagem.
export async function listarUsuarios(ctx: ContextoRequisicao, deps: Partial<DepsAdm> = {}): Promise<readonly ItemListaUsuario[]> {
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  return resolver(deps).cliente.usuario.findMany({
    select: { id: true, nome: true, login: true, ativo: true, bloqueado: true },
    orderBy: [{ nome: 'asc' }, { loginNormalizado: 'asc' }],
  });
}

export type DetalheUsuario = {
  id: string;
  nome: string;
  email: string;
  login: string;
  ativo: boolean;
  bloqueado: boolean;
  perfis: readonly string[];
  unidades: readonly string[];
  ccEscopo: string | null;
  versao: number;
};

// UC02.13: dados do formulário de alteração (a versão volta na gravação).
export async function obterUsuario(ctx: ContextoRequisicao, id: string, deps: Partial<DepsAdm> = {}): Promise<DetalheUsuario | null> {
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  if (!idValido(id)) return null;
  const u = await resolver(deps).cliente.usuario.findUnique({
    where: { id },
    select: {
      id: true,
      nome: true,
      email: true,
      login: true,
      ativo: true,
      bloqueado: true,
      ccEscopo: true,
      versao: true,
      perfis: { select: { perfil: { select: { codigo: true } } } },
      unidades: { select: { unidadeId: true } },
    },
  });
  if (!u) return null;
  return { ...u, perfis: u.perfis.map((p) => p.perfil.codigo).sort(), unidades: u.unidades.map((x) => x.unidadeId).sort() };
}
