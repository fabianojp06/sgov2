import { describe, expect, it } from 'vitest';
import { temCaractereDeControle } from './texto';

describe('temCaractereDeControle', () => {
  it.each(['a\nb', 'a\r', '\t', '\u0000', '\u007f', '\u0085', '\u009f', ' ', ' ', '‮', '⁦', '⁩'])(
    'acusa %j',
    (texto) => {
      expect(temCaractereDeControle(texto)).toBe(true);
    },
  );

  it.each(['Maria', "João D'Ávila-Souza", 'São Paulo · 2027', '€ 1.234,56', 'ç ñ ü', ' '])('aceita %j', (texto) => {
    expect(temCaractereDeControle(texto)).toBe(false);
  });
});
