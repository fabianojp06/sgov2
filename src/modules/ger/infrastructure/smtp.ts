import { createTransport } from 'nodemailer';
import type { Destinatario } from '../domain/modelos-email';
import type { ConfigSmtp } from './config-smtp';

// Transporte SMTP do worker (US-025). Sem server-only: roda no worker.
export interface TransporteEmail {
  enviar(m: { para: Destinatario; assunto: string; texto: string; html: string }): Promise<void>;
}

// Opções que o transporte passa ao nodemailer; o tipo restrito facilita o teste com espião.
export type OpcoesTransporte = {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  ignoreTLS: boolean;
  auth?: { user: string; pass: string };
  tls: { rejectUnauthorized: true; minVersion: 'TLSv1.2' };
  logger: false;
  debug: false;
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
};

type Endereco = { name: string; address: string };
export type CriarTransporte = (opcoes: OpcoesTransporte) => {
  sendMail(m: { from: Endereco; to: Endereco; subject: string; text: string; html: string }): Promise<unknown>;
};

/**
 * - tls: TLS direto (secure: true);
 * - starttls: exige o STARTTLS (requireTLS), para um intermediário não rebaixar a conexão;
 * - nenhuma: só Mailpit/local (lerConfigSmtp garante); ignora o STARTTLS anunciado.
 * Certificado sempre verificado, TLS 1.2 ou mais, sem log do nodemailer (ele registraria o
 * conteúdo). Remetente e destinatário estruturados, nunca uma string montada.
 */
export function criarTransporteSmtp(
  cfg: ConfigSmtp,
  criar: CriarTransporte = createTransport as unknown as CriarTransporte,
): TransporteEmail {
  const transporte = criar({
    host: cfg.host,
    port: cfg.porta,
    secure: cfg.seguranca === 'tls',
    requireTLS: cfg.seguranca === 'starttls',
    ignoreTLS: cfg.seguranca === 'nenhuma',
    ...(cfg.usuario && cfg.senha ? { auth: { user: cfg.usuario, pass: cfg.senha } } : {}),
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    logger: false,
    debug: false,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
  return {
    async enviar({ para, assunto, texto, html }) {
      await transporte.sendMail({
        from: { name: cfg.remetente.nome, address: cfg.remetente.email },
        to: { name: para.nome ?? '', address: para.email },
        subject: assunto,
        text: texto,
        html,
      });
    },
  };
}
