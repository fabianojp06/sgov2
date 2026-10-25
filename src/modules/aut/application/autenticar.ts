import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  conferirSenha,
  hashSenha,
  normalizarLogin,
  obterConfiguracaoAcesso,
  registrarFalhaLogin,
  travarUsuarioParaLogin,
  zerarFalhasLogin,
  type UsuarioParaLogin,
} from '@/modules/adm';
import { auditar } from '@/shared/audit';
import { prisma, type TxCliente } from '@/shared/db';
import { avaliarAntesDaSenha, avaliarFalha } from '../domain/autenticacao';
import { gerarSessaoUid } from '../domain/sessao';

export type MotivoNegacao = 'ENTRADA' | 'MANUTENCAO' | 'CREDENCIAIS' | 'BLOQUEADO' | 'SENHA_EXPIRADA' | 'FALHA_SESSAO';

export type ResultadoLogin =
  | { ok: true; token: string; expiraEm: Date; trocaSenhaObrigatoria: boolean }
  | { ok: false; motivo: MotivoNegacao; mensagem: string; avisoUltimaTentativa: boolean };

export type DepsAut = { cliente: PrismaClient; agora: () => Date };

// Mensagens do EP084 (UC01.01) e a da senha temporária expirada [PROVISÓRIA] (spec §11.2a).
export const MENSAGENS = {
  OBRIGATORIOS: 'Login e/ou Senha são obrigatórios',
  CREDENCIAIS: 'Login ou senha inválidos',
  BLOQUEADO: 'Usuário bloqueado. Contate o Administrador do sistema.',
  MANUTENCAO: 'Sistema está em manutenção',
  ULTIMA_TENTATIVA: 'Atenção: resta 1 (uma) tentativa antes do bloqueio da conta.',
  FALHA_SESSAO: 'Não foi possível iniciar sua sessão. Tente novamente.',
  SENHA_EXPIRADA: 'Senha temporária expirada. Solicite uma nova senha ao Administrador.',
} as const;

const LOGIN_MAXIMO = 60;
const SENHA_MAXIMO = 128;
const FUNCIONALIDADE = 'aut.login';
const ROTULO_INVALIDO = '[inválido]';

// Hash fictício (RNF0005): login inexistente ou inativo também paga um Argon2 com os mesmos
// parâmetros, para o tempo de resposta não revelar se o login existe. Calculado uma vez.
let hashFicticio: Promise<string> | undefined;
const obterHashFicticio = () => (hashFicticio ??= hashSenha(randomBytes(24).toString('base64url')));

const negar = (motivo: MotivoNegacao, mensagem: string, avisoUltimaTentativa = false): ResultadoLogin => ({
  ok: false,
  motivo,
  mensagem,
  avisoUltimaTentativa,
});

export const hashDoToken = (token: string) => createHash('sha256').update(token).digest('hex');

type Tentativa = { usuario: UsuarioParaLogin | null; rotulo: string; ip: string | null; agora: Date };

async function auditarTentativa(tx: TxCliente, t: Tentativa, descricao: string): Promise<void> {
  await auditar(tx, {
    contexto: { usuarioId: t.usuario?.id ?? null, usuarioRotulo: t.rotulo, sessaoUid: null, ip: t.ip },
    funcionalidade: FUNCIONALIDADE,
    tipo: 'LOGIN',
    descricao,
  });
}

async function criarSessao(
  tx: TxCliente,
  usuario: UsuarioParaLogin,
  t: Tentativa,
  maximoHoras: number,
): Promise<{ token: string; expiraEm: Date }> {
  // Sessão única (RN0519): a anterior cai antes de criar a nova.
  const anteriores = await tx.sessaoUsuario.deleteMany({ where: { usuarioId: usuario.id } });
  const token = randomBytes(32).toString('base64url');
  const sessaoUid = gerarSessaoUid(t.agora, t.ip, usuario.id);
  const expiraEm = new Date(t.agora.getTime() + maximoHoras * 60 * 60 * 1000);
  await tx.sessaoUsuario.create({
    data: {
      usuarioId: usuario.id,
      tokenHash: hashDoToken(token),
      sessaoUid,
      ip: t.ip,
      criadaEm: t.agora,
      ultimoAcessoEm: t.agora,
      expiraEm,
      acessoVersao: usuario.acessoVersao,
      trocaSenhaPendente: usuario.trocaSenhaObrigatoria,
    },
  });
  await zerarFalhasLogin(tx, usuario.id);
  const contexto = { usuarioId: usuario.id, usuarioRotulo: usuario.login, sessaoUid, ip: t.ip };
  if (anteriores.count > 0) {
    await auditar(tx, {
      contexto,
      funcionalidade: FUNCIONALIDADE,
      tipo: 'LOGOFF',
      descricao: 'Sessão anterior encerrada por novo acesso',
    });
  }
  await auditar(tx, { contexto, funcionalidade: FUNCIONALIDADE, tipo: 'LOGIN', descricao: 'Login realizado' });
  return { token, expiraEm };
}

// Autenticação (UC01.02), numa transação só (RNF0013). As negações também gravam (contador e
// Histórico); qualquer falha inesperada desfaz tudo e vira FALHA_SESSAO (E5).
export async function autenticar(
  entrada: { login: string; senha: string; ip: string | null },
  deps: Partial<DepsAut> = {},
): Promise<ResultadoLogin> {
  const cliente = deps.cliente ?? prisma;
  const agora = (deps.agora ?? (() => new Date()))();
  const { login, senha } = entrada;
  // RN0012/RN0013/RN0016/RN0014: vazio ou só espaços não vai ao banco nem conta tentativa.
  if (login.trim() === '' || senha.trim() === '') return negar('ENTRADA', MENSAGENS.OBRIGATORIOS);
  if (login.length > LOGIN_MAXIMO || senha.length > SENHA_MAXIMO) return negar('ENTRADA', MENSAGENS.CREDENCIAIS);
  const ip = entrada.ip !== null && isIP(entrada.ip) !== 0 ? entrada.ip : null;
  const normalizado = normalizarLogin(login);

  try {
    return await cliente.$transaction(async (tx) => {
      const config = await obterConfiguracaoAcesso(tx);
      const usuario = normalizado ? await travarUsuarioParaLogin(tx, normalizado) : null;
      const t: Tentativa = { usuario, rotulo: usuario?.login ?? normalizado ?? ROTULO_INVALIDO, ip, agora };

      switch (avaliarAntesDaSenha({ manutencao: config.manutencao, usuario })) {
        case 'MANUTENCAO':
          await auditarTentativa(tx, t, 'Tentativa de login durante a manutenção');
          return negar('MANUTENCAO', MENSAGENS.MANUTENCAO);
        case 'INEXISTENTE':
          await conferirSenha(await obterHashFicticio(), senha);
          await auditarTentativa(tx, t, 'Tentativa de login malsucedida: login inexistente');
          return negar('CREDENCIAIS', MENSAGENS.CREDENCIAIS);
        case 'INATIVO':
          await conferirSenha(await obterHashFicticio(), senha);
          await auditarTentativa(tx, t, 'Tentativa de login malsucedida: usuário inativo');
          return negar('CREDENCIAIS', MENSAGENS.CREDENCIAIS);
        case 'BLOQUEADO':
          await auditarTentativa(tx, t, 'Tentativa de login malsucedida: usuário bloqueado');
          return negar('BLOQUEADO', MENSAGENS.BLOQUEADO);
        case 'CONFERIR':
          break;
      }
      // Aqui o usuário existe (CONFERIR).
      const u = usuario as UsuarioParaLogin;
      if (!(await conferirSenha(u.senhaHash, senha))) {
        const f = avaliarFalha({ contador: u.tentativasFalhas, limite: config.limiteTentativas, limiar: config.limiarAlerta });
        await registrarFalhaLogin(tx, u.id, f.novoContador, f.bloquear);
        await auditarTentativa(tx, t, 'Tentativa de login malsucedida: senha incorreta');
        if (f.bloquear) {
          await auditarTentativa(tx, t, `Usuário ${u.login} bloqueado após ${f.novoContador} tentativas malsucedidas`);
        }
        // O alerta ao Administrador por e-mail (REQ0040) está fora da trilha (D-P5-1): fica no log.
        if (f.alertar || f.bloquear) {
          console.warn('[LOGIN_TENTATIVAS]', { usuarioId: u.id, tentativas: f.novoContador, bloqueado: f.bloquear });
        }
        return negar('CREDENCIAIS', MENSAGENS.CREDENCIAIS, f.ultimaTentativa);
      }
      if (u.senhaExpiraEm && u.senhaExpiraEm.getTime() <= agora.getTime()) {
        await auditarTentativa(tx, t, 'Tentativa de login com senha temporária expirada');
        return negar('SENHA_EXPIRADA', MENSAGENS.SENHA_EXPIRADA);
      }
      const sessao = await criarSessao(tx, u, t, config.sessaoMaximaHoras);
      return { ok: true, ...sessao, trocaSenhaObrigatoria: u.trocaSenhaObrigatoria };
    });
  } catch (erro) {
    // E5: nada foi gravado. A causa vai para o log; o usuário recebe a mensagem do E9.
    console.error('[LOGIN_FALHA_SESSAO]', erro instanceof Error ? { nome: erro.name, mensagem: erro.message } : String(erro));
    return negar('FALHA_SESSAO', MENSAGENS.FALHA_SESSAO);
  }
}
