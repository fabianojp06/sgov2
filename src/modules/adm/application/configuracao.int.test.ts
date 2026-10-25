import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarPrisma } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { obterConfiguracaoAcesso } from './configuracao';

// Configuração de acesso (GAP-AUT-002): leitura, ausência e faixas válidas no banco.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

describe('obterConfiguracaoAcesso', () => {
  it('sem a linha, erro de instalação', async () =>
    expect(app.$transaction((tx) => obterConfiguracaoAcesso(tx))).rejects.toMatchObject({ codigo: 'acesso.configuracao_ausente' }));

  it('mapeia a linha para o tipo, com a política de senha', async () => {
    await migrator.configuracaoAcesso.create({ data: { id: 1 } });
    expect(await app.$transaction((tx) => obterConfiguracaoAcesso(tx))).toEqual({
      limiteTentativas: 5,
      limiarAlerta: 3,
      inatividadeMin: 30,
      sessaoMaximaHoras: 12,
      senhaTemporariaHoras: 24,
      politica: { minimo: 10, exigeLetra: true, exigeDigito: true },
      manutencao: false,
    });
  });

  it.each([
    ['senha_minimo = 200'],
    ['senha_minimo = 4'],
    ['limite_tentativas = 0'],
    ['limiar_alerta = 5'],
    ['limiar_alerta = 0'],
    ['inatividade_min = 0'],
    ['sessao_maxima_horas = 0'],
    ['senha_temporaria_horas = -1'],
  ])('o banco recusa %s', async (atribuicao) =>
    expect(app.$executeRawUnsafe(`UPDATE configuracao_acesso SET ${atribuicao}`)).rejects.toThrow(/check/i));
});
