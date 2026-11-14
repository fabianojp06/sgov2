import { describe, expect, it } from 'vitest';
import { MENSAGENS_APR as M, validarJustificativa } from './solicitacao';

describe('validarJustificativa (RN_WA01_006, D-P26-5)', () => {
  it('aceita 15 caracteres ou mais, aparados', () => {
    expect(validarJustificativa('  Falta a meta 2.  ')).toEqual({ ok: true, valor: 'Falta a meta 2.' });
  });

  it('recusa curta, vazia e não texto', () => {
    for (const t of ['', '   ', 'curta demais', null, 42])
      expect(validarJustificativa(t)).toEqual({ ok: false, erros: [{ campo: 'justificativa', mensagem: M.JUSTIFICATIVA_CURTA }] });
  });

  it('recusa a repetição de um caractere ou de uma palavra', () => {
    expect(validarJustificativa('aaaaaaaaaaaaaaaaaaaa')).toEqual({ ok: false, erros: [{ campo: 'justificativa', mensagem: M.JUSTIFICATIVA_GENERICA }] });
    expect(validarJustificativa('Teste teste teste, teste.')).toEqual({ ok: false, erros: [{ campo: 'justificativa', mensagem: M.JUSTIFICATIVA_GENERICA }] });
    expect(validarJustificativa('teste de recusa da proposta').ok).toBe(true);
  });
});
