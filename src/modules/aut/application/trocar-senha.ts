import type { PrismaClient } from '@/generated/prisma/client';
import {
  conferirSenha,
  gravarNovaSenha,
  hashSenha,
  obterConfiguracaoAcesso,
  registrarFalhaLogin,
  travarUsuarioPorId,
  validarSenha,
  type UsuarioParaLogin,
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
  let contaFalha = false;
  try {
    const r = await executarTroca(lido, voluntaria);
    contaFalha = r.contaFalha;
    return r.resultado;
  } finally {
    if (voluntaria && !contaFalha) limitador.liberar(ctx.ip);
  }

  async function executarTroca(
    lido: UsuarioParaLogin,
    voluntaria: boolean,
  ): Promise<{ resultado: Resultado<{ token: string; expiraEm: Date }>; contaFalha: boolean }> {
    // Fase 1, fora da transação e dentro do limitador (no máximo 2 Argon2 simultâneos): conferências
    // e hash novo. Com a senha atual errada, não roda mais nenhum Argon2.
    const fase1 = await limitador.executar(async () => {
      const atualConfere = voluntaria ? await conferirSenha(lido.senhaHash, entrada.senhaAtual ?? '') : true;
      if (!atualConfere) return { atualConfere, igualAtual: false, novoHash: null };
      const igualAtual = await conferirSenha(lido.senhaHash, entrada.novaSenha);
      return { atualConfere, igualAtual, novoHash: igualAtual ? null : await hashSenha(entrada.novaSenha) };
    });
    if (fase1 === 'OCUPADO') return { resultado: falha([{ campo: '_', mensagem: MSG.LIMITE }]), contaFalha: false };
    if (fase1.igualAtual) return { resultado: falha([{ campo: 'novaSenha', mensagem: MSG.IGUAL_ATUAL }]), contaFalha: false };
    const { novoHash } = fase1;

    // Fase 2, na transação.
    const contexto = { usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip };
    return cliente.$transaction(async (tx) => {
      const u = await travarUsuarioPorId(tx, ctx.usuarioId);
      // A sessão que pediu a troca ainda precisa existir: um logoff ou outro login entre as fases
      // não pode ser desfeito pela rotação do token.
      const sessaoViva = (await tx.sessaoUsuario.count({ where: { usuarioId: ctx.usuarioId, sessaoUid: ctx.sessaoUid } })) === 1;
      if (!u || u.senhaHash !== lido.senhaHash || !u.ativo || u.bloqueado || !sessaoViva) {
        return { resultado: falha([{ campo: '_', mensagem: MSG.ALTERADO }]), contaFalha: false };
      }
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
        return { resultado: falha([{ campo: 'senhaAtual', mensagem: MSG.ATUAL_INCORRETA }]), contaFalha: true };
      }
      await gravarNovaSenha(tx, u.id, novoHash);
      const sessao = await emitirSessao(tx, {
        usuarioId: u.id,
        acessoVersao: u.acessoVersao,
        trocaSenhaPendente: false,
        ip: ctx.ip,
        agora,
        maximoHoras: config.sessaoMaximaHoras,
        inatividadeMin: config.inatividadeMin,
        motivoAnteriores: null,
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
      return { resultado: ok({ token: sessao.token, expiraEm: sessao.expiraEm }), contaFalha: false };
    });
  }
}
