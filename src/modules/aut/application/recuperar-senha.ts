import type { PrismaClient } from '@/generated/prisma/client';
import { enviarEmail } from '@/modules/ger';
import { gravarRecuperacao, hashSenha, normalizarLogin, senhaTemporaria, travarUsuarioParaLogin } from '@/modules/adm';
import { auditar } from '@/shared/audit';
import { lerEnvAcesso } from '@/shared/config';
import { prisma } from '@/shared/db';
import { ErroDominio, falha, ok, type Resultado } from '@/shared/kernel';
import { MENSAGENS } from '../domain/mensagens';
import { obterHashFicticio } from './autenticar';
import { criarLimitadorLogin, type LimitadorLogin } from './limite-login';
import { limitadorLogin } from './limitador';

// Recuperação de senha pela tela de login (US-029; EP084 UC01.01 A1, E5 a E7; RN0516, RN0517; C21).
// - Resposta única (A1.5) para qualquer login: existente ou não, ativo ou não, bloqueado ou não, com
//   ou sem e-mail, acima do limite ou com o limitador ocupado (RN0516). Só o login vazio responde E5.
// - Tempo igual: o Argon2 roda nos dois caminhos (temporária real ou hash fictício), antes da
//   transação e dentro do limitador, como no login; a transação é curta (D-P8-4).
// - A senha vigente não muda (RN0517, D-P8-2): a temporária fica em campos próprios e o e-mail sai
//   pelo outbox na mesma transação. Elegível = existe, ativo, não bloqueado e com e-mail válido (A1.2).
// - Histórico dos dois casos (A1.4, E6.2), sem o login digitado quando não é elegível.
export type DepsRecuperacao = {
  cliente: PrismaClient;
  agora: () => Date;
  enviarEmail: typeof enviarEmail;
  limitador: LimitadorLogin;
  // Vaga de Argon2: a mesma do login (D-P5-1), para a recuperação não somar hashes simultâneos na VPS.
  concorrencia: Pick<LimitadorLogin, 'executar'>;
  hashSenha: (senha: string) => Promise<string>;
};

const FUNCIONALIDADE = 'aut.recuperacao';
const LOGIN_MAXIMO = 60;

// Por login, 3 pedidos por hora [PROVISÓRIO]: cada pedido manda um e-mail à pessoa e troca a
// temporária pendente, então um limite largo viraria inundação da caixa dela. Por IP, um teto alto
// [PROVISÓRIO]: na recuperação não há "falha" para contar, e o NAT junta muitos usuários num IP (D-P8-4).
export const LIMITES_RECUPERACAO = { porIp: 100, porLogin: 3, janelaMs: 60 * 60 * 1000 } as const;
export const limitadorRecuperacao = criarLimitadorLogin(LIMITES_RECUPERACAO);

const contexto = (rotulo: string, usuarioId: string | null, ip: string | null) => ({ usuarioId, usuarioRotulo: rotulo, sessaoUid: null, ip });

export async function solicitarRecuperacaoSenha(
  entrada: { login: string },
  meta: { ip: string | null },
  deps: Partial<DepsRecuperacao> = {},
): Promise<Resultado<{ mensagem: string }>> {
  const cliente = deps.cliente ?? prisma;
  const agora = (deps.agora ?? (() => new Date()))();
  const enviar = deps.enviarEmail ?? enviarEmail;
  const limitador = deps.limitador ?? limitadorRecuperacao;
  const concorrencia = deps.concorrencia ?? limitadorLogin;
  const hash = deps.hashSenha ?? hashSenha;
  const resposta = ok({ mensagem: MENSAGENS.RECUPERACAO_ENVIADA });
  if (typeof entrada.login !== 'string' || entrada.login.trim() === '') return falha([{ campo: 'login', mensagem: MENSAGENS.LOGIN_OBRIGATORIO_RECUPERACAO }]);
  const normalizado = entrada.login.length <= LOGIN_MAXIMO ? normalizarLogin(entrada.login) : null;
  const chave = normalizado ?? entrada.login.trim().toLowerCase().slice(0, LOGIN_MAXIMO);
  if (!limitador.permitir(meta.ip, chave)) {
    console.warn('[RECUPERACAO_LIMITADA]', { ip: meta.ip, motivo: 'taxa' });
    return resposta;
  }

  // Fase 1: leitura sem trava e o Argon2 (real para o elegível, fictício para o resto).
  const fase1 = await concorrencia.executar(async () => {
    const lido = normalizado ? await travarUsuarioParaLogin(cliente, normalizado, false) : null;
    const elegivel = lido !== null && lido.ativo && !lido.bloqueado && lido.email !== '';
    if (!elegivel) {
      await hash(await obterHashFicticio());
      return { lido: null, senha: null };
    }
    return { lido, senha: await senhaTemporaria(cliente, agora, hash) };
  });
  if (fase1 === 'OCUPADO') {
    console.warn('[RECUPERACAO_LIMITADA]', { ip: meta.ip, motivo: 'concorrencia' });
    return resposta;
  }

  // Fase 2: transação curta; o estado é conferido de novo sob a trava. Qualquer erro aqui vai ao log e
  // a resposta continua a A1.5 (E7.4): uma mensagem de erro só no caminho do elegível revelaria o login.
  try {
    await fase2();
  } catch (erro) {
    console.error('[RECUPERACAO_FALHA]', { nome: erro instanceof Error ? erro.name : typeof erro, codigo: (erro as { code?: unknown } | null)?.code ?? null });
  }
  return resposta;

  async function fase2() {
    if (fase1 === 'OCUPADO') return;
    await cliente.$transaction(async (tx) => {
    const u = normalizado ? await travarUsuarioParaLogin(tx, normalizado) : null;
    const elegivel = fase1.senha !== null && u !== null && u.id === fase1.lido?.id && u.ativo && !u.bloqueado;
    if (elegivel) {
      try {
        await enviar(tx, 'usuario.recuperacao_senha', { email: u.email, nome: u.nome }, {
          nome: u.nome,
          login: u.login,
          senhaTemporaria: fase1.senha.senha,
          urlAcesso: `${lerEnvAcesso().urlPublica}/login`,
        });
        await gravarRecuperacao(tx, u.id, fase1.senha.hash, fase1.senha.expiraEm);
        await auditar(tx, {
          contexto: contexto(u.login, u.id, meta.ip),
          funcionalidade: FUNCIONALIDADE,
          tipo: 'SISTEMA',
          registroId: u.id,
          descricao: 'Nova senha temporária enviada por e-mail (recuperação pela tela de login)',
        });
        return;
      } catch (erro) {
        // Destinatário inválido (C4) conta como não elegível, com a mesma resposta (E6).
        if (!(erro instanceof ErroDominio) || erro.codigo !== 'email.destinatario_invalido') throw erro;
      }
    }
    await auditar(tx, {
      contexto: contexto('[recuperação]', null, meta.ip),
      funcionalidade: FUNCIONALIDADE,
      tipo: 'SISTEMA',
      descricao: 'Pedido de nova senha não atendido: login não elegível',
    });
    });
  }
}
