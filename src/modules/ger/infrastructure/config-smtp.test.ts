import { describe, expect, it } from 'vitest';
import { lerConfigSmtp } from './config-smtp';

const base = {
  SMTP_HOST: 'smtp.provedor.com',
  SMTP_SEGURANCA: 'starttls',
  SMTP_USUARIO: 'conta',
  SMTP_SENHA: 'senha-super-secreta-123',
  EMAIL_REMETENTE: 'SGO 2.0 <nao-responda@sgo.exemplo>',
};

function mensagem(fonte: Record<string, string | undefined>): string {
  try {
    lerConfigSmtp(fonte);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('esperava erro');
}

describe('lerConfigSmtp', () => {
  it('sem SMTP_HOST → null (envio desligado)', () => {
    expect(lerConfigSmtp({})).toBeNull();
    expect(lerConfigSmtp({ SMTP_HOST: '  ', SMTP_SEGURANCA: 'tls' })).toBeNull();
  });

  it('lê a configuração completa, com a porta padrão do STARTTLS', () => {
    expect(lerConfigSmtp(base)).toEqual({
      host: 'smtp.provedor.com',
      porta: 587,
      seguranca: 'starttls',
      usuario: 'conta',
      senha: 'senha-super-secreta-123',
      remetente: { nome: 'SGO 2.0', email: 'nao-responda@sgo.exemplo' },
    });
  });

  it('porta padrão 465 com tls, e porta explícita', () => {
    expect(lerConfigSmtp({ ...base, SMTP_SEGURANCA: 'tls' })?.porta).toBe(465);
    expect(lerConfigSmtp({ ...base, SMTP_PORTA: '2525' })?.porta).toBe(2525);
  });

  it('na imagem, SMTP sem TLS só com AMBIENTE=hml ou dev declarado', () => {
    expect(
      lerConfigSmtp({ SMTP_HOST: 'mailpit', SMTP_SEGURANCA: 'nenhuma', EMAIL_REMETENTE: 'a@sgo.local', NODE_ENV: 'production', AMBIENTE: 'hml' })
        ?.seguranca,
    ).toBe('nenhuma');
  });

  it('Mailpit sem TLS, sem autenticação e remetente só com o e-mail', () => {
    expect(
      lerConfigSmtp({ SMTP_HOST: 'mailpit', SMTP_PORTA: '1025', SMTP_SEGURANCA: 'nenhuma', EMAIL_REMETENTE: 'a@sgo.local', AMBIENTE: 'dev' }),
    ).toEqual({ host: 'mailpit', porta: 1025, seguranca: 'nenhuma', remetente: { nome: '', email: 'a@sgo.local' } });
  });

  it.each([
    [{ SMTP_SEGURANCA: undefined }, 'SMTP_SEGURANCA'],
    [{ SMTP_SEGURANCA: 'ssl' }, 'SMTP_SEGURANCA'],
    [{ SMTP_SEGURANCA: 'nenhuma' }, 'SMTP_SEGURANCA'],
    [{ SMTP_HOST: 'mailpit', SMTP_SEGURANCA: 'nenhuma', AMBIENTE: 'producao' }, 'AMBIENTE=producao'],
    [{ SMTP_HOST: 'mailpit', SMTP_SEGURANCA: 'nenhuma', NODE_ENV: 'production' }, 'NODE_ENV=production'],
    [{ SMTP_HOST: 'mailpit', SMTP_SEGURANCA: 'nenhuma', NODE_ENV: 'production', AMBIENTE: 'teste' }, 'NODE_ENV=production'],
    [{ EMAIL_REMETENTE: `${'x'.repeat(121)} <a@b.org>` }, 'EMAIL_REMETENTE'],
    [{ EMAIL_REMETENTE: 'suporte@banco.com <a@b.org>' }, 'EMAIL_REMETENTE'],
    [{ EMAIL_REMETENTE: `${' '.repeat(5000)}<a@b.org>` }, 'EMAIL_REMETENTE'],
    [{ SMTP_PORTA: '0' }, 'SMTP_PORTA'],
    [{ SMTP_PORTA: '70000' }, 'SMTP_PORTA'],
    [{ SMTP_PORTA: '58a' }, 'SMTP_PORTA'],
    [{ SMTP_SENHA: undefined }, 'SMTP_USUARIO e SMTP_SENHA'],
    [{ EMAIL_REMETENTE: undefined }, 'EMAIL_REMETENTE'],
    [{ EMAIL_REMETENTE: 'SGO <a@b.org>, Outro <c@d.org>' }, 'EMAIL_REMETENTE'],
    [{ EMAIL_REMETENTE: 'SGO; x <a@b.org>' }, 'EMAIL_REMETENTE'],
  ])('%j → erro citando %s, sem o valor da senha', (troca, nome) => {
    const msg = mensagem({ ...base, ...troca });
    expect(msg).toContain(nome);
    expect(msg).not.toContain('senha-super-secreta-123');
  });
});
