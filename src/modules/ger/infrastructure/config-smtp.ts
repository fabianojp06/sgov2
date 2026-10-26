import { validarDestinatario } from '../domain/modelos-email';

// Configuração do SMTP do worker (US-025; plano do P4, Task 1a). Sem server-only: roda no worker.
// As mensagens de erro citam só o nome da variável, nunca o valor (a senha não vai para log).
export type ConfigSmtp = {
  host: string;
  porta: number;
  seguranca: 'tls' | 'starttls' | 'nenhuma';
  usuario?: string;
  senha?: string;
  remetente: { nome: string; email: string };
};

const SEGURANCAS = ['tls', 'starttls', 'nenhuma'] as const;
const PORTA_PADRAO = { tls: 465, starttls: 587, nenhuma: 25 } as const;
// Sem TLS só para o Mailpit do compose de dev ou um servidor local.
const HOSTS_SEM_TLS = new Set(['127.0.0.1', 'localhost', '::1', 'mailpit']);
// "Nome <email@dominio>" ou só o e-mail.
const REMETENTE = /^\s*(?:([^<>]*?)\s*<([^<>\s]+)>|([^<>\s]+))\s*$/;

function erro(variavel: string, motivo: string): never {
  throw new Error(`${variavel} ${motivo} (veja o .env.example)`);
}

/** null = sem SMTP_HOST (envio desligado). */
export function lerConfigSmtp(fonte: Readonly<Record<string, string | undefined>> = process.env): ConfigSmtp | null {
  const host = fonte.SMTP_HOST?.trim() ?? '';
  if (!host) return null;

  const seguranca = fonte.SMTP_SEGURANCA?.trim() ?? '';
  if (!(SEGURANCAS as readonly string[]).includes(seguranca)) {
    erro('SMTP_SEGURANCA', 'é obrigatória com SMTP_HOST e deve ser tls, starttls ou nenhuma');
  }
  const seg = seguranca as ConfigSmtp['seguranca'];
  if (seg === 'nenhuma') {
    if (!HOSTS_SEM_TLS.has(host)) erro('SMTP_SEGURANCA', '= nenhuma só vale para o Mailpit ou um SMTP local');
    if (fonte.AMBIENTE?.trim() === 'producao') erro('SMTP_SEGURANCA', '= nenhuma não vale com AMBIENTE=producao');
  }

  const portaBruta = fonte.SMTP_PORTA?.trim() ?? '';
  const porta = portaBruta === '' ? PORTA_PADRAO[seg] : Number(portaBruta);
  if (!/^\d{0,5}$/.test(portaBruta) || !Number.isInteger(porta) || porta < 1 || porta > 65535) {
    erro('SMTP_PORTA', 'deve ser um número de 1 a 65535');
  }

  const usuario = fonte.SMTP_USUARIO?.trim() || undefined;
  const senha = fonte.SMTP_SENHA || undefined;
  if (Boolean(usuario) !== Boolean(senha)) erro('SMTP_USUARIO e SMTP_SENHA', 'vêm juntos ou nenhum dos dois');

  const casado = REMETENTE.exec(fonte.EMAIL_REMETENTE ?? '');
  if (!casado) erro('EMAIL_REMETENTE', 'é obrigatório, no formato "Nome <email@dominio>"');
  const remetente = { nome: (casado[1] ?? '').trim(), email: casado[2] ?? casado[3] ?? '' };
  try {
    validarDestinatario(remetente.nome ? { email: remetente.email, nome: remetente.nome } : { email: remetente.email });
  } catch {
    erro('EMAIL_REMETENTE', 'tem nome ou endereço inválido');
  }

  return { host, porta, seguranca: seg, remetente, ...(usuario && senha ? { usuario, senha } : {}) };
}
