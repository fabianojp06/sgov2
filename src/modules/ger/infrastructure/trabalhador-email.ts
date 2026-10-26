import type { PrismaClient } from '@/generated/prisma/client';
import { auditar } from '@/shared/audit';
import type { FilaGerenciada } from '@/shared/filas';
import { ErroDominio } from '@/shared/kernel';
import {
  mascararEmail,
  MODELOS_SENSIVEIS,
  SENSIBILIDADE_MODELO,
  VALIDADE_MENSAGEM_SENSIVEL_MS,
  validarDadosModelo,
  validarDestinatario,
  type Destinatario,
  type MensagemEmail,
  type ModeloEmail,
} from '../domain/modelos-email';
import { renderizarEmail, VERSOES_MODELO } from '../domain/renderizar-email';
import type { TransporteEmail } from './smtp';

// Trabalhador da fila email.enviar (US-025; plano do P4, Task 1b, R9 e R23).
// Sem server-only: roda no worker.

// Novas tentativas depois da primeira (EP083, UC0.06 E1). A fila tem mais (5, padrão da US-010):
// as duas últimas nunca são usadas, porque a 4ª execução já é a definitiva.
export const NOVAS_TENTATIVAS_EMAIL = 3;

const FILA = 'email.enviar' as const;
const FUNCIONALIDADE = 'ger.email';
const SISTEMA = { usuarioId: null, usuarioRotulo: 'Sistema', sessaoUid: null, ip: null } as const;

export type DepsTrabalhadorEmail = {
  fila: FilaGerenciada;
  transporte: TransporteEmail | null; // null = sem SMTP configurado
  cliente: PrismaClient;
  urlPublica: string;
  agora: () => Date;
  obterNomeExibicao: () => Promise<string>;
};

type Resultado = 'enviado' | 'falha_temporaria' | 'falha_definitiva' | 'expirada';

// Só o que pode ir para log e Histórico: nunca a mensagem do erro, que pode trazer o endereço.
function motivoDoErro(erro: unknown): Record<string, string | number> {
  if (erro instanceof ErroDominio) return { codigo: erro.codigo };
  const e = erro as { code?: unknown; responseCode?: unknown; name?: unknown };
  return {
    ...(typeof e?.code === 'string' ? { codigo: e.code } : {}),
    ...(typeof e?.responseCode === 'number' ? { resposta: e.responseCode } : {}),
    ...(typeof e?.name === 'string' && typeof e?.code !== 'string' ? { tipo: e.name } : {}),
  };
}

// Revalida a mensagem que veio do job (o outbox aceita escrita do app): o worker não confia no
// payload. Monta a mensagem só com os campos conhecidos.
function lerMensagem(m: unknown, urlPublica: string): MensagemEmail {
  const bruta = (typeof m === 'object' && m !== null ? m : {}) as Record<string, unknown>;
  const modelo = bruta.modelo;
  if (typeof modelo !== 'string' || !Object.hasOwn(SENSIBILIDADE_MODELO, modelo)) {
    throw new ErroDominio('email.modelo_desconhecido', 'Modelo de e-mail desconhecido.');
  }
  if (!Number.isInteger(bruta.versao) || !Object.hasOwn(VERSOES_MODELO[modelo as ModeloEmail], bruta.versao as number)) {
    throw new ErroDominio('email.modelo_desconhecido', 'Versão do modelo de e-mail desconhecida.');
  }
  const d = (typeof bruta.destinatario === 'object' && bruta.destinatario !== null ? bruta.destinatario : {}) as Record<string, unknown>;
  if (typeof d.email !== 'string' || (d.nome !== undefined && typeof d.nome !== 'string')) {
    throw new ErroDominio('email.destinatario_invalido', 'Destinatário de e-mail inválido.');
  }
  const destinatario: Destinatario = d.nome === undefined ? { email: d.email } : { email: d.email, nome: d.nome as string };
  validarDestinatario(destinatario);
  validarDadosModelo(modelo as ModeloEmail, bruta.dados, urlPublica);
  const criadoEm = typeof bruta.criadoEm === 'string' ? Date.parse(bruta.criadoEm) : Number.NaN;
  if (Number.isNaN(criadoEm)) throw new ErroDominio('email.dados_invalidos', 'Data da mensagem inválida.', { campo: 'criadoEm' });
  const { nome, login, senhaTemporaria, urlAcesso } = bruta.dados as Record<string, string>;
  return {
    modelo,
    versao: bruta.versao as number,
    destinatario,
    dados: { nome, login, senhaTemporaria, urlAcesso },
    criadoEm: bruta.criadoEm as string,
  } as MensagemEmail;
}

async function jaEnviado(cliente: PrismaClient, idJob: string): Promise<boolean> {
  const marcador = await cliente.historicoOperacao.findFirst({
    where: { funcionalidade: FUNCIONALIDADE, registroId: idJob, depois: { path: ['resultado'], equals: 'enviado' } },
    select: { id: true },
  });
  return marcador !== null;
}

const DESCRICAO: Record<Resultado, string> = {
  enviado: 'E-mail enviado',
  falha_temporaria: 'Falha temporária no envio de e-mail',
  falha_definitiva: 'Falha definitiva no envio de e-mail',
  expirada: 'E-mail não enviado: mensagem expirada',
};

/**
 * Regras (plano do P4, Task 1b):
 * 1. com o marcador "enviado" no Histórico para este job, só apaga o job (nova execução depois de
 *    uma queda não reenvia);
 * 2. revalida destinatário e dados; mensagem inválida é falha definitiva, sem envio;
 * 3. modelo sensível com mais de 24 h é "expirada", sem envio (a senha temporária venceu);
 * 4. falha de envio (inclusive 5xx e "SMTP não configurado") com tentativa < 3 relança para a fila
 *    tentar de novo; na tentativa 3 (4ª execução) é definitiva e não relança;
 * 5. o Histórico (SISTEMA) guarda modelo, versão, destinatário mascarado, tentativa, resultado e
 *    o motivo sem texto livre, nunca os dados. O "enviado" é gravado antes de apagar o job;
 * 6. em resultado final (enviado, definitiva, expirada) o job é apagado num finally. Se apagar
 *    falhar depois de um envio, só registra [EMAIL_JOB_NAO_APAGADO]: relançar reenviaria.
 */
export function criarTrabalhadorEmail(deps: DepsTrabalhadorEmail): (m: unknown, job: { id: string }) => Promise<void> {
  const { fila, cliente } = deps;

  async function apagar(idJob: string, aposEnvio: boolean): Promise<void> {
    try {
      await fila.apagarJob(FILA, idJob);
    } catch (erro) {
      console.error('[EMAIL_JOB_NAO_APAGADO]', { job: idJob, ...motivoDoErro(erro) });
      if (!aposEnvio) throw erro;
    }
  }

  return async (m, job) => {
    if (await jaEnviado(cliente, job.id)) {
      await apagar(job.id, true);
      return;
    }

    const tentativa = (await fila.consultar(FILA, job.id))?.tentativas ?? 0;
    const ultima = tentativa >= NOVAS_TENTATIVAS_EMAIL;
    let mensagem: MensagemEmail | null = null;
    let resultado: Resultado;
    let motivo: Record<string, string | number> = {};

    try {
      mensagem = lerMensagem(m, deps.urlPublica);
    } catch (erro) {
      resultado = 'falha_definitiva';
      motivo = motivoDoErro(erro);
    }

    if (mensagem) {
      const idade = deps.agora().getTime() - Date.parse(mensagem.criadoEm);
      if (MODELOS_SENSIVEIS.has(mensagem.modelo) && idade > VALIDADE_MENSAGEM_SENSIVEL_MS) {
        resultado = 'expirada';
      } else {
        try {
          if (!deps.transporte) throw new ErroDominio('email.smtp_nao_configurado', 'SMTP não configurado.');
          const r = renderizarEmail(mensagem, { nomeExibicao: await deps.obterNomeExibicao() });
          await deps.transporte.enviar({ para: mensagem.destinatario, assunto: r.assunto, texto: r.texto, html: r.html });
          resultado = 'enviado';
        } catch (erro) {
          resultado = ultima ? 'falha_definitiva' : 'falha_temporaria';
          motivo = motivoDoErro(erro);
        }
      }
    }
    resultado ??= 'falha_definitiva';

    const modelo = mensagem?.modelo ?? null;
    const destinatario = mensagem ? mascararEmail(mensagem.destinatario.email) : null;
    const final = resultado !== 'falha_temporaria';
    try {
      await cliente.$transaction((tx) =>
        auditar(tx, {
          contexto: SISTEMA,
          funcionalidade: FUNCIONALIDADE,
          tipo: 'SISTEMA',
          origem: 'SISTEMA',
          registroId: job.id,
          descricao: DESCRICAO[resultado],
          depois: { modelo, versao: mensagem?.versao ?? null, destinatario, tentativa, resultado, motivo },
        }),
      );
    } finally {
      if (final) await apagar(job.id, resultado === 'enviado');
    }

    if (resultado === 'falha_definitiva') {
      console.error('[EMAIL_FALHA_DEFINITIVA]', { job: job.id, modelo, destinatario, tentativa, ...motivo });
    }
    if (resultado === 'falha_temporaria') {
      // Mensagem sem dado do e-mail: o pg-boss guarda o erro no job.
      throw new Error(`Envio de e-mail falhou (tentativa ${tentativa + 1} de ${NOVAS_TENTATIVAS_EMAIL + 1})`);
    }
  };
}
