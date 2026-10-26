import { describe, expect, it, vi } from 'vitest';
import type { ConfigSmtp } from './config-smtp';
import { criarTransporteSmtp, type CriarTransporte, type OpcoesTransporte } from './smtp';

const cfg: ConfigSmtp = {
  host: 'smtp.provedor.com',
  porta: 587,
  seguranca: 'starttls',
  usuario: 'conta',
  senha: 'segredo',
  remetente: { nome: 'SGO 2.0', email: 'nao-responda@sgo.exemplo' },
};

function espiao() {
  const sendMail = vi.fn(async () => ({}));
  const opcoes: OpcoesTransporte[] = [];
  const criar: CriarTransporte = (o) => {
    opcoes.push(o);
    return { sendMail };
  };
  return { criar, opcoes, sendMail };
}

describe('criarTransporteSmtp', () => {
  it('starttls exige o STARTTLS, verifica o certificado e não registra log', () => {
    const e = espiao();
    criarTransporteSmtp(cfg, e.criar);
    expect(e.opcoes[0]).toMatchObject({
      host: 'smtp.provedor.com',
      port: 587,
      secure: false,
      requireTLS: true,
      ignoreTLS: false,
      auth: { user: 'conta', pass: 'segredo' },
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      logger: false,
      debug: false,
    });
  });

  it('tls usa TLS direto', () => {
    const e = espiao();
    criarTransporteSmtp({ ...cfg, seguranca: 'tls', porta: 465 }, e.criar);
    expect(e.opcoes[0]).toMatchObject({ secure: true, requireTLS: false, ignoreTLS: false });
  });

  it('nenhuma (Mailpit) ignora o STARTTLS e vai sem autenticação', () => {
    const e = espiao();
    const semAuth: ConfigSmtp = { host: 'mailpit', porta: 1025, seguranca: 'nenhuma', remetente: cfg.remetente };
    criarTransporteSmtp(semAuth, e.criar);
    expect(e.opcoes[0]).toMatchObject({ secure: false, requireTLS: false, ignoreTLS: true });
    expect(e.opcoes[0]?.auth).toBeUndefined();
  });

  it('envia com remetente e destinatário estruturados', async () => {
    const e = espiao();
    await criarTransporteSmtp(cfg, e.criar).enviar({
      para: { email: 'maria@ex.org', nome: 'Maria' },
      assunto: 'A',
      texto: 'T',
      html: '<p>T</p>',
    });
    expect(e.sendMail).toHaveBeenCalledWith({
      from: { name: 'SGO 2.0', address: 'nao-responda@sgo.exemplo' },
      to: { name: 'Maria', address: 'maria@ex.org' },
      subject: 'A',
      text: 'T',
      html: '<p>T</p>',
    });
  });

  it('o erro do servidor sobe para o trabalhador decidir a nova tentativa', async () => {
    const e = espiao();
    e.sendMail.mockRejectedValueOnce(Object.assign(new Error('550 recusado'), { responseCode: 550 }));
    await expect(
      criarTransporteSmtp(cfg, e.criar).enviar({ para: { email: 'a@b.org' }, assunto: 'A', texto: 'T', html: 'H' }),
    ).rejects.toThrow('550');
  });
});
