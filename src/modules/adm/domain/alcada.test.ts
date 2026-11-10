import { describe, expect, it } from 'vitest';
import { MENSAGENS_ALCADA, validarAlcada } from './alcada';

const T = '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c';
const S = '1c2f7a2b-6d4a-4d3c-8f1b-4e7a2a3b5c6d';

describe('validarAlcada (US-042, §11.4)', () => {
  it('fluxo da lista, titular e substituto diferentes → ok', () => {
    expect(validarAlcada({ fluxo: 'WA01', titularId: T, substitutoId: S })).toEqual({ ok: true, valor: { fluxo: 'WA01', titularId: T, substitutoId: S } });
  });

  it('titular igual ao substituto → erro no substituto', () => {
    expect(validarAlcada({ fluxo: 'WA05', titularId: T, substitutoId: T })).toEqual({ ok: false, erros: [{ campo: 'substitutoId', mensagem: MENSAGENS_ALCADA.DIFERENTES }] });
  });

  it('fluxo fora da lista (WA03 e WA04 só depois do GAP-APR-001) e aprovadores ausentes → um erro por campo', () => {
    expect(validarAlcada({ fluxo: 'WA03', titularId: '', substitutoId: undefined })).toEqual({
      ok: false,
      erros: [
        { campo: 'fluxo', mensagem: MENSAGENS_ALCADA.FLUXO },
        { campo: 'titularId', mensagem: MENSAGENS_ALCADA.TITULAR },
        { campo: 'substitutoId', mensagem: MENSAGENS_ALCADA.SUBSTITUTO },
      ],
    });
  });

  it('mensagens de fluxo sem aprovador: WA02 fala em validador homologador (UC6.02 E2)', () => {
    expect(MENSAGENS_ALCADA.SEM_APROVADOR('WA02')).toContain('validador homologador');
    expect(MENSAGENS_ALCADA.SEM_APROVADOR('WA01')).toBe('Operação indisponível: Não há aprovador ativo cadastrado para este fluxo. Contate o Administrador do sistema.');
    expect(MENSAGENS_ALCADA.SEM_APROVADOR('WA05')).toBe(MENSAGENS_ALCADA.SEM_APROVADOR('WA01'));
  });
});
