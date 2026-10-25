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

  it.each(['sem-arroba', '', 'a@b', 'a b@c.org', '@c.org', 'a@@c.org', 'a@c.org\nBcc: x@y.org'])(
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

describe('enviarEmail (real, antes da US-010)', () => {
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

  it('dados do modelo sem senhaTemporaria não compilam', async () => {
    const falso = emailFalso();
    // @ts-expect-error senhaTemporaria é obrigatória no modelo usuario.senha_inicial
    await falso.enviarEmail(tx, 'usuario.senha_inicial', { email: 'a@b.org' }, { nome: 'x', login: 'y', urlAcesso: 'z' });
    expect(falso.enviados).toHaveLength(1);
  });
});
