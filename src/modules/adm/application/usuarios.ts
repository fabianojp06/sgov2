import { z } from 'zod';
import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { carregarIndiceEstrutura } from '@/modules/cad/servidor';
import { enviarEmail } from '@/modules/ger';
import { auditar, type ContextoAuditoria } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { lerEnvAcesso } from '@/shared/config';
import { prisma, travarRecurso, type TxCliente } from '@/shared/db';
import { ErroDominio, falha, ok, type Resultado } from '@/shared/kernel';
import { aplicarExcecoes, chaveExcecao, type Excecao } from '../domain/excecao-usuario';
import { MENSAGENS_USUARIO, perdeUltimoAdministrador, validarUsuario, type UsuarioValidado } from '../domain/usuario';
import { gerarSenhaTemporaria } from '../infrastructure/gerar-senha';
import { hashSenha } from '../infrastructure/senha-argon2';
import { obterConfiguracaoAcesso } from './configuracao';
import { carregarCatalogoExcecoes, type CatalogoExcecoes, type FuncionalidadePainel } from './excecoes-usuario';

// Casos de uso de usuário (UC02.11 a UC02.14, UC02.18; US-038). Cada um chama exigir primeiro e
// roda numa transação só, com o Histórico e o e-mail (contrato C4) no mesmo tx: se a auditoria ou
// o registro do e-mail falhar, nada é gravado. O Argon2 da senha temporária roda antes, fora dela.
// estrutura: o C1 do cad, para conferir o CC de escopo (C25); os testes injetam o falso.
export type DepsAdm = {
  cliente: PrismaClient;
  agora: () => Date;
  enviarEmail: typeof enviarEmail;
  estrutura: { carregarIndiceEstrutura: typeof carregarIndiceEstrutura };
};

const FUNCIONALIDADE = 'adm.usuarios';

function resolver(deps: Partial<DepsAdm>): DepsAdm {
  return {
    cliente: deps.cliente ?? prisma,
    agora: deps.agora ?? (() => new Date()),
    enviarEmail: deps.enviarEmail ?? enviarEmail,
    estrutura: deps.estrutura ?? { carregarIndiceEstrutura },
  };
}

// O cadastro de usuários não é por TP: o Histórico sai sem unidade, mesmo com um TP selecionado.
const contextoAuditoria = (ctx: ContextoRequisicao): ContextoAuditoria => ({
  usuarioId: ctx.usuarioId,
  usuarioRotulo: ctx.usuarioRotulo,
  sessaoUid: ctx.sessaoUid,
  ip: ctx.ip,
  unidadeId: null,
});

// O que vai ao Histórico: os dados do formulário, nunca senha ou hash. As exceções (US-039) entram
// como "<perfil>:<funcionalidade>".
const retrato = (u: Omit<UsuarioValidado, 'loginNormalizado'>) => ({
  nome: u.nome,
  email: u.email,
  login: u.login,
  ativo: u.ativo,
  perfis: [...u.perfis].sort(),
  unidades: [...u.unidades].sort(),
  ccEscopo: u.ccEscopo,
  excecoes: u.excecoes.map(chaveExcecao).sort(),
});

const ehLoginDuplicado = (erro: unknown) => erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002';
const loginDuplicado = () => falha([{ campo: 'login', mensagem: MENSAGENS_USUARIO.LOGIN_DUPLICADO }]);
// Perfil excluído pela tela de perfis entre a leitura e a associação (US-037, ajuste A6): a exclusão
// trava a linha do perfil, e a FK do usuario_perfil recusa o vínculo depois do commit dela.
const ehPerfilExcluido = (erro: unknown) => erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2003';
const perfilExcluido = () => falha([{ campo: 'perfis', mensagem: MENSAGENS_USUARIO.PERFIL_EXCLUIDO }]);
const alterado = () => falha([{ campo: '_', mensagem: MENSAGENS_USUARIO.ALTERADO }]);

// Serializa as mudanças que podem tirar o último Administrador ativo. Depende do READ COMMITTED
// (padrão do projeto): cada comando depois da trava enxerga o que a transação anterior gravou. Sob
// REPEATABLE READ ou SERIALIZABLE, o snapshot seria o de antes da espera e a contagem erraria.
const travarAdministradores = (tx: TxCliente) => travarRecurso(tx, 'adm:administradores');

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
  estrutura: DepsAdm['estrutura'],
  atuais: { perfis: readonly string[]; unidades: readonly string[]; ccEscopo: string | null } = { perfis: [], unidades: [], ccEscopo: null },
): Promise<Resultado<{ perfis: Perfil[] }>> {
  const perfis = await tx.perfil.findMany({ where: { codigo: { in: [...u.perfis] } }, select: { id: true, codigo: true, nome: true, ativo: true } });
  const perfilAceito = (codigo: string) => perfis.some((p) => p.codigo === codigo && (p.ativo || atuais.perfis.includes(codigo)));
  if (!u.perfis.every(perfilAceito)) return falha([{ campo: 'perfis', mensagem: MENSAGENS_USUARIO.PERFIL_INVALIDO }]);
  const novas = u.unidades.filter((x) => !atuais.unidades.includes(x));
  const existentes = u.unidades.length === 0 ? [] : await tx.unidade.findMany({ where: { id: { in: [...u.unidades] } }, select: { id: true, ativo: true } });
  const unidadeAceita = (id: string) => existentes.some((x) => x.id === id && (x.ativo || !novas.includes(id)));
  if (!u.unidades.every(unidadeAceita)) return falha([{ campo: 'unidades', mensagem: MENSAGENS_USUARIO.UNIDADE_INVALIDA }]);
  // C25 pelo C1: o CC de escopo novo precisa ter CCs analíticos ativos na subárvore (o mesmo critério da
  // visão do orc, R16); escopo vazio não vê nada. Como os vínculos inativos, o que já estava gravado é
  // mantido pelo Salvar, mesmo que a estrutura tenha mudado depois.
  if (u.ccEscopo && u.ccEscopo !== atuais.ccEscopo) {
    const indice = await estrutura.carregarIndiceEstrutura(tx);
    if (indice.centrosCustoAnaliticosSob(u.ccEscopo).length === 0) {
      return falha([{ campo: 'ccEscopo', mensagem: MENSAGENS_USUARIO.CC_FORA_ESTRUTURA }]);
    }
  }
  // Na ordem pedida (padrões e perfis da tela, D-P13-2); o retrato do Histórico ordena os códigos.
  return ok({ perfis: u.perfis.map((codigo) => perfis.find((p) => p.codigo === codigo)!) });
}

// Exceções de permissão (US-039): confere as pedidas contra o catálogo dos perfis e aplica a REQ0081
// (o perfil com todas as funcionalidades retiradas sai) ANTES das checagens de RN0079, do CC de
// escopo e do último Administrador, que veem os perfis já convertidos. Devolve o usuário revalidado,
// com as exceções finais: as pedidas e as atuais que o painel não exibiu (ajuste M1 da revisão 12.12).
async function aplicarExcecoesDoUsuario(
  tx: TxCliente,
  u: UsuarioValidado,
  antes: { perfis: readonly string[]; excecoes: readonly Excecao<UsuarioValidado['perfis'][number]>[] } = { perfis: [], excecoes: [] },
): Promise<Resultado<{ usuario: UsuarioValidado; catalogo: CatalogoExcecoes }>> {
  const catalogo = await carregarCatalogoExcecoes(tx, [...new Set([...u.perfis, ...antes.perfis])]);
  const aplicadas = aplicarExcecoes(u.perfis, u.excecoes, catalogo.funcionalidades, catalogo.ehAdministracao, {
    atuais: antes.excecoes,
    exibidas: u.exibidas,
  });
  if (!aplicadas.ok) return aplicadas;
  if (aplicadas.valor.perfisDesmarcados.length === 0) return ok({ usuario: { ...u, excecoes: aplicadas.valor.excecoes }, catalogo });
  const v = validarUsuario({ ...u, perfis: aplicadas.valor.perfis, excecoes: aplicadas.valor.excecoes });
  return v.ok ? ok({ usuario: v.valor, catalogo }) : v;
}

// Histórico por exceção criada ou removida (D-P10-5). [PROVISÓRIO]: o EP085 não dá o texto; o
// análogo é a RN0056 (perfil associado ao usuário).
async function auditarExcecoes(
  tx: TxCliente,
  contexto: ContextoAuditoria,
  registroId: string,
  nomeUsuario: string,
  nomePerfil: (codigo: string) => string,
  nomeFuncionalidade: (codigo: string) => string,
  criadas: readonly Excecao[],
  removidas: readonly Excecao[],
): Promise<void> {
  for (const e of criadas) {
    await auditar(tx, {
      contexto,
      funcionalidade: FUNCIONALIDADE,
      tipo: 'INSERCAO',
      registroId,
      descricao: `Funcionalidade ${nomeFuncionalidade(e.funcionalidade)} do perfil ${nomePerfil(e.perfil)} retirada do usuário ${nomeUsuario}`,
      depois: { perfil: e.perfil, funcionalidade: e.funcionalidade },
    });
  }
  for (const e of removidas) {
    await auditar(tx, {
      contexto,
      funcionalidade: FUNCIONALIDADE,
      tipo: 'EXCLUSAO',
      registroId,
      descricao: `Funcionalidade ${nomeFuncionalidade(e.funcionalidade)} do perfil ${nomePerfil(e.perfil)} devolvida ao usuário ${nomeUsuario}`,
      antes: { perfil: e.perfil, funcionalidade: e.funcionalidade },
    });
  }
}

// Também a recuperação pela tela de login (US-029), pelo servidor.ts; hash injetável para os testes.
export async function senhaTemporaria(cliente: PrismaClient, agora: Date, hash: (senha: string) => Promise<string> = hashSenha) {
  const config = await obterConfiguracaoAcesso(cliente);
  const senha = gerarSenhaTemporaria(config.politica);
  return { senha, hash: await hash(senha), expiraEm: new Date(agora.getTime() + config.senhaTemporariaHoras * 3600_000) };
}

const urlAcesso = () => `${lerEnvAcesso().urlPublica}/login`;

// UC02.12: cadastro com senha gerada pelo sistema e enviada por e-mail (RN0059, RN0071).
export async function cadastrarUsuario(ctx: ContextoRequisicao, entrada: unknown, deps: Partial<DepsAdm> = {}): Promise<Resultado<{ id: string }>> {
  exigir(ctx, FUNCIONALIDADE, 'incluir');
  const { cliente, agora, enviarEmail: enviar, estrutura } = resolver(deps);
  const v = validarUsuario(entrada);
  if (!v.ok) return v;
  const senha = await senhaTemporaria(cliente, agora());
  const contexto = contextoAuditoria(ctx);
  try {
    return await cliente.$transaction(async (tx) => {
      if (await tx.usuario.findUnique({ where: { loginNormalizado: v.valor.loginNormalizado }, select: { id: true } })) return loginDuplicado();
      const comExcecoes = await aplicarExcecoesDoUsuario(tx, v.valor);
      if (!comExcecoes.ok) return comExcecoes;
      const { usuario: u, catalogo } = comExcecoes.valor;
      const vinculos = await resolverVinculos(tx, u, estrutura);
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
      // UC02.12 A2: as exceções entram depois do vínculo com o perfil (FK para usuario_perfil).
      const idPerfil = (codigo: string) => vinculos.valor.perfis.find((p) => p.codigo === codigo)!.id;
      if (u.excecoes.length > 0) {
        await tx.usuarioExcecao.createMany({
          data: u.excecoes.map((e) => ({ usuarioId: id, perfilId: idPerfil(e.perfil), funcionalidadeCodigo: e.funcionalidade })),
        });
      }
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
      const nomePerfil = (codigo: string) => vinculos.valor.perfis.find((p) => p.codigo === codigo)!.nome;
      await auditarExcecoes(tx, contexto, id, u.nome, nomePerfil, catalogo.nome, u.excecoes, []);
      await enviar(tx, 'usuario.senha_inicial', { email: u.email, nome: u.nome }, { nome: u.nome, login: u.login, senhaTemporaria: senha.senha, urlAcesso: urlAcesso() });
      return ok({ id });
    });
  } catch (erro) {
    // Dois cadastros simultâneos do mesmo login: o índice único decide (RN0065).
    if (ehLoginDuplicado(erro)) return loginDuplicado();
    if (ehPerfilExcluido(erro)) return perfilExcluido();
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
  const { cliente, agora, estrutura } = resolver(deps);
  if (!idValido(id)) throw inexistente();
  const contexto = contextoAuditoria(ctx);
  try {
    return await cliente.$transaction((tx) => gravarAlteracao(tx));
  } catch (erro) {
    if (ehPerfilExcluido(erro)) return perfilExcluido();
    throw erro;
  }

  async function gravarAlteracao(tx: TxCliente): Promise<Resultado<void>> {
    await travarAdministradores(tx);
    const atual = await tx.usuario.findUnique({
      where: { id },
      include: {
        perfis: { include: { perfil: { select: { codigo: true, nome: true } }, excecoes: { select: { funcionalidadeCodigo: true } } } },
        unidades: { select: { unidadeId: true } },
      },
    });
    if (!atual) throw inexistente();
    if (atual.versao !== versao) return alterado();
    const v = validarUsuario({ ...entrada, login: atual.login });
    if (!v.ok) return v;
    const perfisAntes = atual.perfis.map((p) => p.perfil);
    const codigosAntes = perfisAntes.map((p) => p.codigo);
    const unidadesAntes = atual.unidades.map((x) => x.unidadeId);
    const excecoesAntes = atual.perfis.flatMap((p) =>
      p.excecoes.map((e) => ({ perfil: p.perfil.codigo as UsuarioValidado['perfis'][number], funcionalidade: e.funcionalidadeCodigo })),
    );
    // Só sai a exceção que o painel exibiu e voltou marcada; a não exibida (funcionalidade inativa, de
    // módulo inativo, ou reativada depois que o formulário abriu) é mantida (ajustes M2 e M1). Sem o
    // painel (exibidas ausente), nenhuma sai. A de perfil retirado cai com ele (cascata).
    const comExcecoes = await aplicarExcecoesDoUsuario(tx, v.valor, { perfis: codigosAntes, excecoes: excecoesAntes });
    if (!comExcecoes.ok) return comExcecoes;
    const { usuario: u, catalogo } = comExcecoes.valor;
    const antes = retrato({ ...atual, perfis: codigosAntes as UsuarioValidado['perfis'], unidades: unidadesAntes, excecoes: excecoesAntes });
    // Salvar sem mudança nenhuma não grava nem audita.
    if (JSON.stringify(antes) === JSON.stringify(retrato(u))) return ok(undefined);
    const vinculos = await resolverVinculos(tx, u, estrutura, { perfis: codigosAntes, unidades: unidadesAntes, ccEscopo: atual.ccEscopo });
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
    const chavesAntes = new Set(excecoesAntes.map(chaveExcecao));
    const chavesDepois = new Set(u.excecoes.map(chaveExcecao));
    const excecoesCriadas = u.excecoes.filter((e) => !chavesAntes.has(chaveExcecao(e)));
    // Só as de perfis que continuam: as do perfil retirado caem em cascata com o vínculo e não geram
    // Histórico próprio (basta a entrada "Perfil ... desassociado", ajuste B3).
    const excecoesRemovidas = excecoesAntes.filter((e) => u.perfis.includes(e.perfil) && !chavesDepois.has(chaveExcecao(e)));
    const mudouAcesso =
      incluidos.length > 0 ||
      retirados.length > 0 ||
      excecoesCriadas.length > 0 ||
      excecoesRemovidas.length > 0 ||
      atual.ativo !== u.ativo ||
      atual.ccEscopo !== u.ccEscopo;

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
        // Inativar apaga a temporária pendente da recuperação (US-029).
        ...(!u.ativo ? { recuperacaoHash: null, recuperacaoExpiraEm: null } : {}),
      },
    });
    if (count === 0) return alterado();
    if (retirados.length > 0) {
      const ids = vinculos.valor.perfis.map((p) => p.id);
      await tx.usuarioPerfil.deleteMany({ where: { usuarioId: id, perfilId: { notIn: ids } } });
    }
    if (incluidos.length > 0) await tx.usuarioPerfil.createMany({ data: incluidos.map((p) => ({ usuarioId: id, perfilId: p.id })) });
    const perfil = (codigo: string) => vinculos.valor.perfis.find((p) => p.codigo === codigo)!;
    for (const e of excecoesRemovidas) {
      await tx.usuarioExcecao.delete({
        where: { usuarioId_perfilId_funcionalidadeCodigo: { usuarioId: id, perfilId: perfil(e.perfil).id, funcionalidadeCodigo: e.funcionalidade } },
      });
    }
    if (excecoesCriadas.length > 0) {
      await tx.usuarioExcecao.createMany({
        data: excecoesCriadas.map((e) => ({ usuarioId: id, perfilId: perfil(e.perfil).id, funcionalidadeCodigo: e.funcionalidade })),
      });
    }
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
    await auditarExcecoes(tx, contexto, id, u.nome, (codigo) => perfil(codigo).nome, catalogo.nome, excecoesCriadas, excecoesRemovidas);
    return ok(undefined);
  }
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
    const atual = await tx.usuario.findUnique({ where: { id }, select: { nome: true, email: true, login: true, ativo: true, bloqueado: true, versao: true, trocaSenhaObrigatoria: true } });
    if (!atual) throw inexistente();
    if (!atual.ativo) return falha([{ campo: '_', mensagem: MENSAGENS_USUARIO.RESET_INATIVO }]);
    // Bloqueado, a senha nova chegaria por e-mail sem permitir o login: o desbloqueio vem antes (A3).
    if (atual.bloqueado) return falha([{ campo: '_', mensagem: MENSAGENS_USUARIO.RESET_BLOQUEADO }]);
    const { count } = await tx.usuario.updateMany({
      // ativo e bloqueado também no WHERE: um bloqueio por tentativas entre a leitura e aqui não muda
      // a versão, e o reset não pode passar por ele.
      where: { id, versao: atual.versao, ativo: true, bloqueado: false },
      data: {
        senhaHash: senha.hash,
        trocaSenhaObrigatoria: true,
        senhaExpiraEm: senha.expiraEm,
        atualizadoEm: agora(),
        acessoVersao: { increment: 1 },
        // A temporária da recuperação pela tela de login (US-029) sai: só uma senha temporária vale.
        recuperacaoHash: null,
        recuperacaoExpiraEm: null,
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
  // Exceções de permissão (US-039): funcionalidades retiradas, por perfil.
  excecoes: readonly { perfil: string; funcionalidade: string }[];
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
      perfis: { select: { perfil: { select: { codigo: true } }, excecoes: { select: { funcionalidadeCodigo: true } } } },
      unidades: { select: { unidadeId: true } },
    },
  });
  if (!u) return null;
  return {
    ...u,
    perfis: u.perfis.map((p) => p.perfil.codigo).sort(),
    unidades: u.unidades.map((x) => x.unidadeId).sort(),
    excecoes: u.perfis
      .flatMap((p) => p.excecoes.map((e) => ({ perfil: p.perfil.codigo, funcionalidade: e.funcionalidadeCodigo })))
      .sort((a, b) => chaveExcecao(a).localeCompare(chaveExcecao(b))),
  };
}

export type OpcoesUsuario = {
  // Por perfil, o painel "Funcionalidade(s) do Perfil" (US-039): retiráveis com checkbox, fixas sem.
  perfis: readonly {
    codigo: string;
    nome: string;
    ativo: boolean;
    funcionalidades: readonly FuncionalidadePainel[];
    fixas: readonly FuncionalidadePainel[];
  }[];
  unidades: readonly { id: string; nome: string; ativo: boolean }[];
};

// Opções dos painéis de perfis e TPs do formulário: as ativas e, na alteração, também as inativas
// já vinculadas ao usuário, para o Salvar não desfazer o vínculo sem o Administrador ver.
export async function listarOpcoesUsuario(ctx: ContextoRequisicao, usuarioId?: string, deps: Partial<DepsAdm> = {}): Promise<OpcoesUsuario> {
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const { cliente } = resolver(deps);
  const vinculado = usuarioId !== undefined && idValido(usuarioId) ? { usuarios: { some: { usuarioId } } } : undefined;
  const filtro = vinculado ? { OR: [{ ativo: true }, vinculado] } : { ativo: true };
  const [perfis, unidades] = await Promise.all([
    cliente.perfil.findMany({ where: filtro, select: { codigo: true, nome: true, ativo: true }, orderBy: { nome: 'asc' } }),
    cliente.unidade.findMany({ where: filtro, select: { id: true, nome: true, ativo: true }, orderBy: { nome: 'asc' } }),
  ]);
  const catalogo = await carregarCatalogoExcecoes(cliente, perfis.map((p) => p.codigo));
  return {
    perfis: perfis.map((p) => ({ ...p, funcionalidades: catalogo.painel(p.codigo).retiraveis, fixas: catalogo.painel(p.codigo).fixas })),
    unidades,
  };
}
