import { describe, expect, it } from 'vitest';
import { gerarSessaoUid } from './sessao';

describe('gerarSessaoUid (RN0062)', () => {
  const id = '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c';
  it('base64 de timestamp|ip|usuário', () => {
    const uid = gerarSessaoUid(new Date('2026-11-11T12:00:00.000Z'), '203.0.113.9', id);
    expect(atob(uid)).toBe(`2026-11-11T12:00:00.000Z|203.0.113.9|${id}`);
  });
  it('sem IP', () => expect(atob(gerarSessaoUid(new Date(0), null, id))).toBe(`1970-01-01T00:00:00.000Z|-|${id}`));
});
