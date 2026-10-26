import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TxCliente } from '@/shared/db';
import { ErroDominio } from '@/shared/kernel';
import { emailFalso as criarEmailFalso, enviarEmail, MODELOS_SENSIVEIS, VERSAO_ATUAL, type DadosModeloEmail } from '@/modules/ger';

// Contrato C4 (plano do P3, Tarefa 3; real na US-025, plano do P4, Task 1a): e-mail por outbox.
// O tx falso só registra o que o registrarNoOutbox grava.
const criados: { tipo: string; dados: unknown }[] = [];
const tx = {
  outboxMensagem: {
    create: async ({ data }: { data: { tipo: string; dados: unknown } }) => {
      criados.push(data);
      return data;
    },
  },
} as unknown as TxCliente;
const URL_PUBLICA = 'https://sgo.exemplo';
const emailFalso = () => criarEmailFalso({ urlPublica: URL_PUBLICA });

beforeEach(() => {
  criados.length = 0;
  vi.stubEnv('URL_PUBLICA', URL_PUBLICA);
});
afterEach(() => {
  vi.unstubAllEnvs();
});
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

describe('enviarEmail (real)', () => {
  it('valida o destinatário antes de tudo, sem gravar nada', async () => {
    expect(await codigoDoErro(enviarEmail(tx, 'usuario.senha_inicial', { email: 'sem-arroba' }, dados))).toBe(
      'email.destinatario_invalido',
    );
    expect(criados).toEqual([]);
  });

  it('grava no outbox a mensagem com modelo, versão, destinatário, dados e criadoEm', async () => {
    const antes = Date.now();
    await enviarEmail(tx, 'usuario.senha_redefinida', { email: 'a@b.org', nome: 'Maria' }, dados);
    expect(criados).toHaveLength(1);
    const [{ tipo, dados: mensagem }] = criados as [{ tipo: string; dados: Record<string, unknown> }];
    expect(tipo).toBe('email.enviar');
    expect(mensagem).toMatchObject({
      modelo: 'usuario.senha_redefinida',
      versao: VERSAO_ATUAL['usuario.senha_redefinida'],
      destinatario: { email: 'a@b.org', nome: 'Maria' },
      dados,
    });
    const criadoEm = Date.parse(String(mensagem.criadoEm));
    expect(criadoEm).toBeGreaterThanOrEqual(antes);
    expect(criadoEm).toBeLessThanOrEqual(Date.now());
  });

  it('recusa link de outra origem que a URL_PUBLICA, sem gravar nada', async () => {
    const outro = { ...dados, urlAcesso: 'https://atacante.exemplo/login' };
    expect(await codigoDoErro(enviarEmail(tx, 'usuario.senha_inicial', { email: 'a@b.org' }, outro))).toBe(
      'email.dados_invalidos',
    );
    expect(criados).toEqual([]);
  });

  it('o falso aplica a mesma validação dos dados', async () => {
    const falso = emailFalso();
    const outro = { ...dados, urlAcesso: 'https://sgo.exemplo/login?x=1' };
    expect(await codigoDoErro(falso.enviarEmail(tx, 'usuario.senha_inicial', { email: 'a@b.org' }, outro))).toBe(
      'email.dados_invalidos',
    );
    expect(falso.enviados).toEqual([]);
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

  it('dados do modelo sem senhaTemporaria não compilam (e, forçados, são recusados)', async () => {
    const falso = emailFalso();
    const semSenha = { nome: 'x', login: 'y', urlAcesso: `${URL_PUBLICA}/login` };
    // @ts-expect-error senhaTemporaria é obrigatória no modelo usuario.senha_inicial
    const envio = falso.enviarEmail(tx, 'usuario.senha_inicial', { email: 'a@b.org' }, semSenha);
    expect(await codigoDoErro(envio)).toBe('email.dados_invalidos');
    expect(falso.enviados).toEqual([]);
  });
});
