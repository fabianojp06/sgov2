import { describe, expect, it } from 'vitest';
import { TAMANHO_NOME_EXIBICAO, validarNomeExibicao } from './instituicao';

describe('validarNomeExibicao (#434)', () => {
  it('tira os espaços das pontas; vazio é permitido', () => {
    expect(validarNomeExibicao('  Instituto Exemplo  ')).toEqual({ ok: true, valor: 'Instituto Exemplo' });
    expect(validarNomeExibicao('   ')).toEqual({ ok: true, valor: '' });
  });

  it('até 120 caracteres (o limite do cabeçalho do e-mail)', () => {
    expect(validarNomeExibicao('x'.repeat(TAMANHO_NOME_EXIBICAO)).ok).toBe(true);
    expect(validarNomeExibicao('x'.repeat(TAMANHO_NOME_EXIBICAO + 1))).toMatchObject({ ok: false, erros: [{ campo: 'nome' }] });
  });

  it.each([['quebra de linha', 'a\nb'], ['tabulação', 'a\tb'], ['DEL', 'a\u007fb'], ['C1', 'a\u0085b'], ['separador de linha', 'a b']])(
    'recusa %s, como o e-mail',
    (_, texto) => {
      expect(validarNomeExibicao(texto)).toMatchObject({ ok: false, erros: [{ campo: 'nome' }] });
    },
  );

  it('acentos e símbolos comuns passam', () => {
    expect(validarNomeExibicao('Fundação São João — Unidade 1 (Matriz) & Cia.').ok).toBe(true);
  });
});
