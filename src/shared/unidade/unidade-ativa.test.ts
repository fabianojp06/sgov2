import { describe, expect, it } from 'vitest';
import { resolverUnidadeAtiva } from './unidade-ativa';

describe('resolverUnidadeAtiva (§6.7)', () => {
  const a = { id: 'a' };
  const b = { id: 'b' };
  it('uma só vira a ativa, mesmo sem escolha', () => expect(resolverUnidadeAtiva([a], null)).toBe('a'));
  it('escolhida dentro da lista', () => expect(resolverUnidadeAtiva([a, b], 'b')).toBe('b'));
  it('escolhida fora da lista → null', () => expect(resolverUnidadeAtiva([a, b], 'x')).toBeNull());
  it('várias e nenhuma escolhida → null', () => expect(resolverUnidadeAtiva([a, b], null)).toBeNull());
  it('nenhuma → null', () => expect(resolverUnidadeAtiva([], 'a')).toBeNull());
});
