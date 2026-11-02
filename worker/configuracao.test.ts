import { describe, expect, it } from 'vitest';
import { lerConfiguracaoWorker } from './configuracao';

const imagem = { NODE_ENV: 'production', AMBIENTE: 'hml', URL_PUBLICA: 'https://sgo.exemplo' };

describe('configuração de partida do worker', () => {
  it('lê o ambiente e a URL pública', () => {
    expect(lerConfiguracaoWorker(imagem)).toEqual({ ambiente: 'hml', urlPublica: 'https://sgo.exemplo' });
  });

  it('na imagem, sem AMBIENTE, não parte', () => {
    expect(() => lerConfiguracaoWorker({ ...imagem, AMBIENTE: undefined })).toThrow('AMBIENTE ausente ou inválido');
  });

  it('AMBIENTE=teste não é um valor válido', () => {
    expect(() => lerConfiguracaoWorker({ ...imagem, AMBIENTE: 'teste' })).toThrow('AMBIENTE ausente ou inválido');
  });

  it('na imagem, sem URL_PUBLICA, não parte', () => {
    expect(() => lerConfiguracaoWorker({ ...imagem, URL_PUBLICA: undefined })).toThrow('[URL_PUBLICA_AUSENTE]');
  });

  it('URL_PUBLICA com caminho é inválida', () => {
    expect(() => lerConfiguracaoWorker({ ...imagem, URL_PUBLICA: 'https://sgo.exemplo/app' })).toThrow('[URL_PUBLICA_INVALIDA]');
  });
});
