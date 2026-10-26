// Entrada só de servidor do ger (plano do P4, R22): worker, seed e casos de uso de outros módulos.
// Páginas e componentes usam o index.ts (o lint proíbe app/ e ui/ de importar este arquivo).
// Nada aqui importa @/shared/authz nem next/ (o worker/bundle.test.ts reprova).
import type { PrismaClient } from '@/generated/prisma/client';
import { lerEnvAcesso } from '@/shared/config';
import type { FilaGerenciada } from '@/shared/filas';
import { lerConfigSmtp } from './infrastructure/config-smtp';
import { criarTransporteSmtp } from './infrastructure/smtp';
import { criarTrabalhadorEmail } from './infrastructure/trabalhador-email';

export { lerAmbiente, type Ambiente } from './infrastructure/ambiente';
export { NOVAS_TENTATIVAS_EMAIL } from './infrastructure/trabalhador-email';

/**
 * Registra os trabalhadores do ger no worker: hoje, o de email.enviar. Ele é registrado mesmo sem
 * SMTP (cada tentativa falha com "SMTP não configurado" e a mensagem não fica parada com a senha,
 * R23); nesse caso, emite [EMAIL_SEM_SMTP] uma vez. O nome de exibição da instituição vem do cad a
 * partir da Task 9; até lá, vazio.
 */
export async function registrarTrabalhadoresGer(
  fila: FilaGerenciada,
  deps: { cliente: PrismaClient; obterNomeExibicao?: () => Promise<string> },
): Promise<void> {
  const config = lerConfigSmtp();
  if (!config) console.warn('[EMAIL_SEM_SMTP] SMTP_HOST não definido: os e-mails falham até a configuração.');
  await fila.registrarTrabalhador(
    'email.enviar',
    criarTrabalhadorEmail({
      fila,
      transporte: config ? criarTransporteSmtp(config) : null,
      cliente: deps.cliente,
      urlPublica: lerEnvAcesso().urlPublica,
      agora: () => new Date(),
      obterNomeExibicao: deps.obterNomeExibicao ?? (async () => ''),
    }),
  );
}
