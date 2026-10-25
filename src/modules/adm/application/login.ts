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
  ehAdministrador: boolean;
  acessoVersao: number;
};

type Linha = Omit<UsuarioParaLogin, 'ehAdministrador'> & { eh_administrador: boolean };

// travar = true: a linha fica presa até o fim da transação (FOR NO KEY UPDATE, RNF0011), e duas
// tentativas simultâneas não passam do limite. NO KEY não bloqueia as FKs de outras tabelas.
// travar = false: leitura sem trava, para conferir a senha fora da transação.
export async function travarUsuarioParaLogin(
  tx: TxCliente,
  loginNormalizado: string,
  travar = true,
): Promise<UsuarioParaLogin | null> {
  const trava = travar ? Prisma.sql`FOR NO KEY UPDATE OF u` : Prisma.empty;
  const linhas = await tx.$queryRaw<Linha[]>`
    SELECT u.id, u.nome, u.login_normalizado AS login, u.ativo, u.bloqueado,
      u.tentativas_falhas AS "tentativasFalhas", u.senha_hash AS "senhaHash",
      u.troca_senha_obrigatoria AS "trocaSenhaObrigatoria", u.senha_expira_em AS "senhaExpiraEm",
      u.acesso_versao AS "acessoVersao",
      EXISTS (
        SELECT 1 FROM usuario_perfil up JOIN perfil p ON p.id = up.perfil_id
        WHERE up.usuario_id = u.id AND p.codigo = 'ADMINISTRADOR' AND p.ativo
      ) AS eh_administrador
    FROM usuario u WHERE u.login_normalizado = ${loginNormalizado}
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
    data: { tentativasFalhas: novoContador, ...(bloquear ? { bloqueado: true } : {}) },
  });
}

// Login bem-sucedido zera o contador (RN0025).
export async function zerarFalhasLogin(tx: TxCliente, usuarioId: string): Promise<void> {
  await tx.usuario.update({ where: { id: usuarioId }, data: { tentativasFalhas: 0 } });
}
