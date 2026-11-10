import { Prisma } from '@/generated/prisma/client';
import type { TxCliente } from '@/shared/db';

// Dados do usuário que o aut precisa para autenticar (UC01.02).
export type UsuarioParaLogin = {
  id: string;
  nome: string;
  login: string;
  ativo: boolean;
  bloqueado: boolean;
  tentativasFalhas: number;
  senhaHash: string;
  trocaSenhaObrigatoria: boolean;
  senhaExpiraEm: Date | null;
  // Recuperação pela tela de login (US-029): a temporária pendente, que convive com a senha vigente.
  email: string;
  recuperacaoHash: string | null;
  recuperacaoExpiraEm: Date | null;
  ehAdministrador: boolean;
  acessoVersao: number;
};

type Linha = Omit<UsuarioParaLogin, 'ehAdministrador'> & { eh_administrador: boolean };

// travar = true: a linha fica presa até o fim da transação (FOR NO KEY UPDATE, RNF0011), e duas
// tentativas simultâneas não passam do limite. NO KEY não bloqueia as FKs de outras tabelas.
// travar = false: leitura sem trava, para conferir a senha fora da transação.
export function travarUsuarioParaLogin(tx: TxCliente, loginNormalizado: string, travar = true): Promise<UsuarioParaLogin | null> {
  return buscar(tx, Prisma.sql`u.login_normalizado = ${loginNormalizado}`, travar);
}

// O mesmo, pelo id (troca de senha do usuário logado).
export function travarUsuarioPorId(tx: TxCliente, usuarioId: string, travar = true): Promise<UsuarioParaLogin | null> {
  return buscar(tx, Prisma.sql`u.id = ${usuarioId}::uuid`, travar);
}

async function buscar(tx: TxCliente, condicao: Prisma.Sql, travar: boolean): Promise<UsuarioParaLogin | null> {
  const trava = travar ? Prisma.sql`FOR NO KEY UPDATE OF u` : Prisma.empty;
  const linhas = await tx.$queryRaw<Linha[]>`
    SELECT u.id, u.nome, u.login_normalizado AS login, u.ativo, u.bloqueado,
      u.tentativas_falhas AS "tentativasFalhas", u.senha_hash AS "senhaHash",
      u.troca_senha_obrigatoria AS "trocaSenhaObrigatoria", u.senha_expira_em AS "senhaExpiraEm",
      u.acesso_versao AS "acessoVersao", u.email, u.recuperacao_hash AS "recuperacaoHash",
      u.recuperacao_expira_em AS "recuperacaoExpiraEm",
      EXISTS (
        SELECT 1 FROM usuario_perfil up JOIN perfil p ON p.id = up.perfil_id
        WHERE up.usuario_id = u.id AND p.codigo = 'ADMINISTRADOR' AND p.ativo
      ) AS eh_administrador
    FROM usuario u WHERE ${condicao}
    ${trava}`;
  const l = linhas[0];
  if (!l) return null;
  const { eh_administrador, ...resto } = l;
  return { ...resto, ehAdministrador: eh_administrador };
}

// Senha errada: grava o novo contador e, no limite, o bloqueio, na mesma transação (UC01.05).
export async function registrarFalhaLogin(tx: TxCliente, usuarioId: string, novoContador: number, bloquear: boolean): Promise<void> {
  await tx.usuario.update({
    where: { id: usuarioId },
    // O bloqueio também muda a versão de acesso: as sessões abertas caem e não voltam a valer num
    // desbloqueio futuro.
    // O bloqueio também apaga a temporária pendente da recuperação (US-029).
    data: {
      tentativasFalhas: novoContador,
      ...(bloquear ? { bloqueado: true, acessoVersao: { increment: 1 }, recuperacaoHash: null, recuperacaoExpiraEm: null } : {}),
    },
  });
}

// Recuperação pela tela de login (US-029): grava a temporária pendente; a senha vigente não muda.
export async function gravarRecuperacao(tx: TxCliente, usuarioId: string, hash: string, expiraEm: Date): Promise<void> {
  await tx.usuario.update({ where: { id: usuarioId }, data: { recuperacaoHash: hash, recuperacaoExpiraEm: expiraEm } });
}

// Uso único (D-P8-3): o login com a temporária, o login com a vigente e a troca a apagam.
export async function limparRecuperacao(tx: TxCliente, usuarioId: string): Promise<void> {
  await tx.usuario.updateMany({ where: { id: usuarioId, recuperacaoHash: { not: null } }, data: { recuperacaoHash: null, recuperacaoExpiraEm: null } });
}

// Login bem-sucedido zera o contador (RN0025).
export async function zerarFalhasLogin(tx: TxCliente, usuarioId: string): Promise<void> {
  await tx.usuario.update({ where: { id: usuarioId }, data: { tentativasFalhas: 0 } });
}

// Permissões efetivas (RN0030/RN0031): perfis ativos × funcionalidades ativas × módulos ativos,
// no formato "<funcionalidade>:<acao>" do C5. Com `modulo`, só as funcionalidades desse módulo (com
// o sistema inativo, o Administrador fica só com a Administração, RN0060). A exceção de permissão do
// usuário (US-039, REQ0080, D-P10-3) tira a funcionalidade que vem daquele perfil; outro perfil do
// usuário que a dê sem exceção a mantém (o DISTINCT junta os perfis). Daqui saem o menu, a guarda e
// o Histórico visível (RN0099).
export async function carregarPermissoes(tx: TxCliente, usuarioId: string, filtro: { modulo?: string } = {}): Promise<ReadonlySet<string>> {
  const doModulo = filtro.modulo === undefined ? Prisma.empty : Prisma.sql`AND m.codigo = ${filtro.modulo}`;
  const linhas = await tx.$queryRaw<{ p: string }[]>`
    SELECT DISTINCT pp.funcionalidade_codigo || ':' || pp.acao AS p
    FROM usuario_perfil up
    JOIN perfil pe ON pe.id = up.perfil_id AND pe.ativo
    JOIN perfil_permissao pp ON pp.perfil_id = pe.id
    JOIN funcionalidade f ON f.codigo = pp.funcionalidade_codigo AND f.ativo
    JOIN modulo m ON m.codigo = f.modulo_codigo AND m.ativo
    WHERE up.usuario_id = ${usuarioId}::uuid ${doModulo}
      AND NOT EXISTS (
        SELECT 1 FROM adm_usuario_excecao ex
        WHERE ex.usuario_id = up.usuario_id AND ex.perfil_id = up.perfil_id AND ex.funcionalidade_codigo = pp.funcionalidade_codigo
      )`;
  return new Set(linhas.map((l) => l.p));
}

// Estado do usuário que decide se a sessão continua valendo. ehAdministrador: a mesma definição da
// RN0023 no login (perfil ADMINISTRADOR ativo), para a sessão de quem não é Administrador cair com o
// sistema inativo.
export async function obterUsuarioParaSessao(
  tx: TxCliente,
  usuarioId: string,
): Promise<{ nome: string; login: string; ativo: boolean; bloqueado: boolean; acessoVersao: number; ehAdministrador: boolean } | null> {
  const u = await tx.usuario.findUnique({
    where: { id: usuarioId },
    select: {
      nome: true,
      loginNormalizado: true,
      ativo: true,
      bloqueado: true,
      acessoVersao: true,
      perfis: { where: { perfil: { codigo: 'ADMINISTRADOR', ativo: true } }, select: { perfilId: true }, take: 1 },
    },
  });
  return (
    u && {
      nome: u.nome,
      login: u.loginNormalizado,
      ativo: u.ativo,
      bloqueado: u.bloqueado,
      acessoVersao: u.acessoVersao,
      ehAdministrador: u.perfis.length > 0,
    }
  );
}

// Destinatários do alerta de tentativas de acesso (US-027, REQ0040): usuários ativos, sem bloqueio e
// com e-mail cadastrado que tenham o perfil ADMINISTRADOR ativo. Ordem por nome, para o envio ser
// estável.
export type AdministradorParaAlerta = { id: string; nome: string; email: string };

export function listarAdministradoresParaAlerta(tx: TxCliente): Promise<AdministradorParaAlerta[]> {
  return tx.usuario.findMany({
    where: {
      ativo: true,
      bloqueado: false,
      email: { not: '' },
      perfis: { some: { perfil: { codigo: 'ADMINISTRADOR', ativo: true } } },
    },
    select: { id: true, nome: true, email: true },
    orderBy: [{ nome: 'asc' }, { id: 'asc' }],
  });
}
