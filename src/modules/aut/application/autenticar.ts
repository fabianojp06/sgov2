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
import { MENSAGENS } from '../domain/mensagens';
import { gerarSessaoUid } from '../domain/sessao';

export type MotivoNegacao = 'ENTRADA' | 'MANUTENCAO' | 'CREDENCIAIS' | 'BLOQUEADO' | 'SENHA_EXPIRADA' | 'FALHA_SESSAO';

export type ResultadoLogin =
  | { ok: true; token: string; expiraEm: Date; trocaSenhaObrigatoria: boolean }
  | { ok: false; motivo: MotivoNegacao; mensagem: string; avisoUltimaTentativa: boolean };

export type DepsAut = { cliente: PrismaClient; agora: () => Date };

export { MENSAGENS };

const LOGIN_MAXIMO = 60;
const SENHA_MAXIMO = 128;
const FUNCIONALIDADE = 'aut.login';
const ROTULO_INVALIDO = '[inválido]';

// Hash fictício (RNF0005): login inexistente ou inativo também paga um Argon2 com os mesmos
// parâmetros, para o tempo de resposta não revelar se o login existe. Calculado uma vez.
// Se o cálculo falhar, o cache é limpo: uma falha guardada viraria FALHA_SESSAO só para logins
// inexistentes, um oráculo de enumeração.
let hashFicticio: Promise<string> | undefined;
function obterHashFicticio(): Promise<string> {
  hashFicticio ??= hashSenha(randomBytes(24).toString('base64url')).catch((erro: unknown) => {
    hashFicticio = undefined;
    throw erro;
  });
  return hashFicticio;
}

// IP que o tipo inet aceita: isIP aceita zona IPv6 ('fe80::1%eth0'), que o Postgres recusa e que
// derrubaria a transação (e o incremento do contador).
const ipValido = (ip: string | null): string | null => (ip !== null && !ip.includes('%') && isIP(ip) !== 0 ? ip : null);

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

type Alerta = { usuarioId: string; tentativas: number; bloqueado: boolean };

// Autenticação (UC01.02) em duas fases:
// 1. fora da transação: lê o usuário sem trava e paga o Argon2 (real ou fictício). Assim o hash não
//    prende conexão nem a linha, e duas tentativas no mesmo login não fazem fila (oráculo de tempo);
// 2. na transação (RNF0013): trava a linha (RNF0011), reavalia o estado atual e grava contador,
//    bloqueio, sessão e Histórico. Se o hash mudou entre as fases, confere de novo sob a trava.
// As negações também gravam; qualquer falha inesperada desfaz tudo e vira FALHA_SESSAO (E5).
export async function autenticar(
  entrada: { login: string; senha: string; ip: string | null },
  deps: Partial<DepsAut> = {},
): Promise<ResultadoLogin> {
  const cliente = deps.cliente ?? prisma;
  const agora = (deps.agora ?? (() => new Date()))();
  const { login, senha } = entrada;
  // RN0012/RN0013/RN0016/RN0014: vazio, só espaços ou não texto não vai ao banco nem conta tentativa.
  if (typeof login !== 'string' || typeof senha !== 'string' || login.trim() === '' || senha.trim() === '') {
    return negar('ENTRADA', MENSAGENS.OBRIGATORIOS);
  }
  // Entrada maior que qualquer login ou senha válidos: resposta rápida, sem Argon2 (ruling da 2a).
  if (login.length > LOGIN_MAXIMO || senha.length > SENHA_MAXIMO) return negar('ENTRADA', MENSAGENS.CREDENCIAIS);
  const ip = ipValido(entrada.ip);
  const normalizado = normalizarLogin(login);

  try {
    // Fase 1.
    const previa = await obterConfiguracaoAcesso(cliente);
    const lido = normalizado ? await travarUsuarioParaLogin(cliente, normalizado, false) : null;
    let conferido: { hash: string; confere: boolean } | null = null;
    const decisao = avaliarAntesDaSenha({ manutencao: previa.manutencao, usuario: lido });
    if (decisao === 'INEXISTENTE' || decisao === 'INATIVO') {
      await conferirSenha(await obterHashFicticio(), senha);
    } else if (decisao === 'CONFERIR' && lido) {
      conferido = { hash: lido.senhaHash, confere: await conferirSenha(lido.senhaHash, senha) };
    }

    // Fase 2.
    const { resultado, alerta } = await cliente.$transaction(async (tx): Promise<{ resultado: ResultadoLogin; alerta?: Alerta }> => {
      const config = await obterConfiguracaoAcesso(tx);
      const usuario = normalizado ? await travarUsuarioParaLogin(tx, normalizado) : null;
      const t: Tentativa = { usuario, rotulo: usuario?.login ?? normalizado ?? ROTULO_INVALIDO, ip, agora };

      switch (avaliarAntesDaSenha({ manutencao: config.manutencao, usuario })) {
        case 'MANUTENCAO':
          await auditarTentativa(tx, t, 'Tentativa de login durante a manutenção');
          return { resultado: negar('MANUTENCAO', MENSAGENS.MANUTENCAO) };
        case 'INEXISTENTE':
          await auditarTentativa(tx, t, 'Tentativa de login malsucedida: login inexistente');
          return { resultado: negar('CREDENCIAIS', MENSAGENS.CREDENCIAIS) };
        case 'INATIVO':
          await auditarTentativa(tx, t, 'Tentativa de login malsucedida: usuário inativo');
          return { resultado: negar('CREDENCIAIS', MENSAGENS.CREDENCIAIS) };
        case 'BLOQUEADO':
          await auditarTentativa(tx, t, 'Tentativa de login malsucedida: usuário bloqueado');
          return { resultado: negar('BLOQUEADO', MENSAGENS.BLOQUEADO) };
        case 'CONFERIR':
          break;
      }
      // Aqui o usuário existe (CONFERIR).
      const u = usuario as UsuarioParaLogin;
      const confere = conferido?.hash === u.senhaHash ? conferido.confere : await conferirSenha(u.senhaHash, senha);
      if (!confere) {
        const f = avaliarFalha({ contador: u.tentativasFalhas, limite: config.limiteTentativas, limiar: config.limiarAlerta });
        await registrarFalhaLogin(tx, u.id, f.novoContador, f.bloquear);
        await auditarTentativa(tx, t, 'Tentativa de login malsucedida: senha incorreta');
        if (f.bloquear) {
          await auditarTentativa(tx, t, `Usuário ${u.login} bloqueado após ${f.novoContador} tentativas malsucedidas`);
        }
        const alerta = f.alertar || f.bloquear ? { usuarioId: u.id, tentativas: f.novoContador, bloqueado: f.bloquear } : undefined;
        return { resultado: negar('CREDENCIAIS', MENSAGENS.CREDENCIAIS, f.ultimaTentativa), ...(alerta ? { alerta } : {}) };
      }
      if (u.senhaExpiraEm && u.senhaExpiraEm.getTime() <= agora.getTime()) {
        await auditarTentativa(tx, t, 'Tentativa de login com senha temporária expirada');
        return { resultado: negar('SENHA_EXPIRADA', MENSAGENS.SENHA_EXPIRADA) };
      }
      const sessao = await criarSessao(tx, u, t, config.sessaoMaximaHoras);
      return { resultado: { ok: true, ...sessao, trocaSenhaObrigatoria: u.trocaSenhaObrigatoria } };
    });
    // Só depois do commit: o alerta ao Administrador por e-mail (REQ0040) está fora da trilha
    // (D-P5-1) e fica no log.
    if (alerta) console.warn('[LOGIN_TENTATIVAS]', alerta);
    return resultado;
  } catch (erro) {
    // E5: nada foi gravado. Só o nome e o código do erro vão ao log: a mensagem do Prisma pode
    // trazer argumentos da consulta.
    console.error('[LOGIN_FALHA_SESSAO]', {
      nome: erro instanceof Error ? erro.name : typeof erro,
      codigo: (erro as { code?: unknown } | null)?.code ?? null,
    });
    return negar('FALHA_SESSAO', MENSAGENS.FALHA_SESSAO);
  }
}
