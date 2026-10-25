import { describe, expect, it } from 'vitest';
import type { TxCliente } from '@/shared/db';
import { ErroDominio } from '@/shared/kernel';
import { emailFalso, enviarEmail, MODELOS_SENSIVEIS, type DadosModeloEmail } from '@/modules/ger';

// Contrato C4 (plano do P3, Tarefa 3): e-mail por outbox do módulo ger.
// O contrato não toca o banco antes da US-025: um objeto vazio serve de tx.
const tx = {} as TxCliente;
const dados: DadosModeloEmail['usuario.senha_inicial'] = {
  nome: 'Maria',
  login: 'maria.silva',
  senhaTemporaria: 'Tmp-123456',
  urlAcesso: 'https://sgo.exemplo/login',
};

async function codigoDoErro(promessa: Promise<unknown>): Promise<string | undefined> {
  try {
    await promessa;
    return undefined;
  } catch (e) {
    expect(e).toBeInstanceOf(ErroDominio);
    return (e as ErroDominio).codigo;
  }
}

describe('emailFalso', () => {
  it('registra o envio em memória', async () => {
    const falso = emailFalso();
    await falso.enviarEmail(tx, 'usuario.senha_inicial', { email: 'a@b.org', nome: 'Maria' }, dados);
    expect(falso.enviados).toEqual([
      { modelo: 'usuario.senha_inicial', destinatario: { email: 'a@b.org', nome: 'Maria' }, dados },
    ]);
  });

  it.each([
    'sem-arroba',
    '',
    'a@b',
    'a b@c.org',
    '@c.org',
    'a@@c.org',
    'a@c.org\nBcc: x@y.org',
    'a@b.org,c.d',
    'a@b.org;c@d.org',
    '"a"@b.org',
    '<a@b.org>',
    'a\u0000@b.org',
    `${'a'.repeat(250)}@b.org`,
  ])(
    'recusa o destinatário %j como o real',
    async (email) => {
      const falso = emailFalso();
      expect(await codigoDoErro(falso.enviarEmail(tx, 'usuario.senha_inicial', { email }, dados))).toBe(
        'email.destinatario_invalido',
      );
      expect(falso.enviados).toEqual([]);
    },
  );
});

describe('nome do destinatário', () => {
  it.each(['Maria\r\nBcc: x@y.org', 'Maria\nBcc: x@y.org', 'x <atacante@ex.org>, ', 'a;b', 'Maria "M"', 'tab\tnome'])(
    'recusa o nome %j no falso e no real',
    async (nome) => {
      const falso = emailFalso();
      expect(await codigoDoErro(falso.enviarEmail(tx, 'usuario.senha_inicial', { email: 'a@b.org', nome }, dados))).toBe(
        'email.destinatario_invalido',
      );
      expect(await codigoDoErro(enviarEmail(tx, 'usuario.senha_inicial', { email: 'a@b.org', nome }, dados))).toBe(
        'email.destinatario_invalido',
      );
    },
  );

  it('aceita nome com acento, hífen e apóstrofo', async () => {
    const falso = emailFalso();
    await falso.enviarEmail(tx, 'usuario.senha_inicial', { email: 'joao.d@b.org', nome: "João D'Ávila-Souza" }, dados);
    expect(falso.enviados).toHaveLength(1);
  });

  it('não leva o endereço cru para os detalhes do erro', async () => {
    try {
      await enviarEmail(tx, 'usuario.senha_inicial', { email: 'segredo@x' }, dados);
    } catch (e) {
      expect(JSON.stringify((e as ErroDominio).detalhes)).not.toContain('segredo@x');
    }
  });
});

describe('enviarEmail (real, antes da US-025)', () => {
  it('valida o destinatário antes de tudo', async () => {
    expect(await codigoDoErro(enviarEmail(tx, 'usuario.senha_inicial', { email: 'sem-arroba' }, dados))).toBe(
      'email.destinatario_invalido',
    );
  });

  it('com destinatário válido, avisa que o envio ainda não existe', async () => {
    expect(await codigoDoErro(enviarEmail(tx, 'usuario.senha_redefinida', { email: 'a@b.org' }, dados))).toBe(
      'email.indisponivel',
    );
  });
});

describe('modelos', () => {
  it('os modelos com senha são sensíveis (dados apagados após o envio)', () => {
    expect([...MODELOS_SENSIVEIS].sort()).toEqual(['usuario.senha_inicial', 'usuario.senha_redefinida']);
  });

  it('o falso tipa os dados pelo modelo registrado', async () => {
    const falso = emailFalso();
    await falso.enviarEmail(tx, 'usuario.senha_inicial', { email: 'a@b.org' }, dados);
    const [envio] = falso.enviados;
    if (envio?.modelo === 'usuario.senha_inicial') expect(envio.dados.senhaTemporaria).toBe('Tmp-123456');
    else expect.unreachable();
  });

  it('dados do modelo sem senhaTemporaria não compilam', async () => {
    const falso = emailFalso();
    // @ts-expect-error senhaTemporaria é obrigatória no modelo usuario.senha_inicial
    await falso.enviarEmail(tx, 'usuario.senha_inicial', { email: 'a@b.org' }, { nome: 'x', login: 'y', urlAcesso: 'z' });
    expect(falso.enviados).toHaveLength(1);
  });
});
