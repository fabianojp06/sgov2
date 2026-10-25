import type { PrismaClient } from '@/generated/prisma/client';
import {
  conferirSenha,
  gravarNovaSenha,
  hashSenha,
  obterConfiguracaoAcesso,
  registrarFalhaLogin,
  travarUsuarioPorId,
  validarSenha,
} from '@/modules/adm';
import { auditar } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { prisma } from '@/shared/db';
import { ErroDominio, falha, ok, type Resultado } from '@/shared/kernel';
import { avaliarFalha } from '../domain/autenticacao';
import type { LimitadorLogin } from './limite-login';
import { limitadorLogin } from './limitador';
import { emitirSessao } from './sessao';

type DepsTroca = { cliente: PrismaClient; agora: () => Date; limitador: LimitadorLogin };

export type EntradaTroca = { senhaAtual?: string | undefined; novaSenha: string; repetirSenha: string };

// Mensagens [PROVISÓRIAS] (spec §11.2a).
const MSG = {
  DIFERENTES: 'A nova senha e a confirmação devem ser iguais',
  IGUAL_ATUAL: 'A nova senha deve ser diferente da atual',
  ATUAL_INCORRETA: 'Senha atual incorreta',
  LIMITE: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
  ALTERADO: 'Este registro foi alterado por outro usuário. Recarregue a tela.',
} as const;

// Troca de senha (UC02.19, REQ0039). A voluntária exige a senha atual (D-P5-3), conferida pelo
// mesmo limitador do login, e um erro dela conta no contador de falhas. Como no login, o Argon2
// roda fora da transação; a transação trava a linha e confere se nada mudou. Ao final, o token é
// rotacionado: a sessão passa de "só troca de senha" para o acesso completo.
export async function trocarSenha(
  ctx: ContextoRequisicao,
  entrada: EntradaTroca,
  deps: Partial<DepsTroca> = {},
): Promise<Resultado<{ token: string; expiraEm: Date }>> {
  const cliente = deps.cliente ?? prisma;
  const agora = (deps.agora ?? (() => new Date()))();
  const limitador = deps.limitador ?? limitadorLogin;
  if (entrada.novaSenha !== entrada.repetirSenha) return falha([{ campo: 'repetirSenha', mensagem: MSG.DIFERENTES }]);
  const config = await obterConfiguracaoAcesso(cliente);
  const errosPolitica = validarSenha(entrada.novaSenha, config.politica);
  if (errosPolitica.length > 0) return falha(errosPolitica);

  const encontrado = await travarUsuarioPorId(cliente, ctx.usuarioId, false);
  if (!encontrado) throw new ErroDominio('aut.usuario_ausente', 'Sessão expirada. Entre novamente.');
  const lido = encontrado;
  const voluntaria = !lido.trocaSenhaObrigatoria;
  if (voluntaria && !entrada.senhaAtual) return falha([{ campo: 'senhaAtual', mensagem: MSG.ATUAL_INCORRETA }]);
  if (voluntaria && !limitador.permitir(ctx.ip, lido.login)) return falha([{ campo: '_', mensagem: MSG.LIMITE }]);
  // A vaga reservada no limite por IP só fica quando a senha atual estava errada (contaFalhaPorIp).
  let falhouAtual = false;
  try {
    return await executarTroca();
  } finally {
    if (voluntaria && !falhouAtual) limitador.liberar(ctx.ip);
  }

  async function executarTroca(): Promise<Resultado<{ token: string; expiraEm: Date }>> {
  // Fase 1, fora da transação: conferências e hash novo.
  const conferencias = await limitador.executar(async () => ({
    atualConfere: voluntaria ? await conferirSenha(lido.senhaHash, entrada.senhaAtual ?? '') : true,
    igualAtual: await conferirSenha(lido.senhaHash, entrada.novaSenha),
  }));
  if (conferencias === 'OCUPADO') return falha([{ campo: '_', mensagem: MSG.LIMITE }]);
  if (conferencias.atualConfere && conferencias.igualAtual) return falha([{ campo: 'novaSenha', mensagem: MSG.IGUAL_ATUAL }]);
  const novoHash = conferencias.atualConfere ? await hashSenha(entrada.novaSenha) : null;

  // Fase 2, na transação.
  const contexto = { usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip };
  const r = await cliente.$transaction(async (tx): Promise<Resultado<{ token: string; expiraEm: Date }>> => {
    const u = await travarUsuarioPorId(tx, ctx.usuarioId);
    if (!u || u.senhaHash !== lido.senhaHash || !u.ativo || u.bloqueado) return falha([{ campo: '_', mensagem: MSG.ALTERADO }]);
    if (!novoHash) {
      const f = avaliarFalha({ contador: u.tentativasFalhas, limite: config.limiteTentativas, limiar: config.limiarAlerta });
      await registrarFalhaLogin(tx, u.id, f.novoContador, f.bloquear);
      await auditar(tx, { contexto, funcionalidade: 'aut.senha', tipo: 'SISTEMA', descricao: 'Troca de senha recusada: senha atual incorreta' });
      if (f.bloquear) {
        await auditar(tx, {
          contexto,
          funcionalidade: 'aut.senha',
          tipo: 'SISTEMA',
          descricao: `Usuário ${u.login} bloqueado após ${f.novoContador} tentativas malsucedidas`,
        });
      }
      return falha([{ campo: 'senhaAtual', mensagem: MSG.ATUAL_INCORRETA }]);
    }
    await gravarNovaSenha(tx, u.id, novoHash);
    const sessao = await emitirSessao(tx, {
      usuarioId: u.id,
      acessoVersao: u.acessoVersao,
      trocaSenhaPendente: false,
      ip: ctx.ip,
      agora,
      maximoHoras: config.sessaoMaximaHoras,
    });
    await auditar(tx, {
      contexto: { ...contexto, sessaoUid: sessao.sessaoUid },
      funcionalidade: 'aut.senha',
      tipo: 'ALTERACAO',
      registroId: u.id,
      descricao: voluntaria ? 'Senha alterada pelo usuário' : 'Senha alterada no primeiro acesso',
      antes: { primeiroAcessoPendente: u.trocaSenhaObrigatoria },
      depois: { primeiroAcessoPendente: false },
    });
    return ok({ token: sessao.token, expiraEm: sessao.expiraEm });
  });
  falhouAtual = !r.ok && r.erros.some((e) => e.campo === 'senhaAtual');
  return r;
  }
}
