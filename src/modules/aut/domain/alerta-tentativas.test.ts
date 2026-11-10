import { describe, expect, it } from 'vitest';
import { formatarDataHoraAlerta } from './alerta-tentativas';

describe('formatarDataHoraAlerta (US-027, REQ0040)', () => {
  it('pt-BR no fuso de São Paulo', () => {
    expect(formatarDataHoraAlerta(new Date('2026-11-11T12:00:00.000Z'))).toBe('11/11/2026, 09:00');
  });

  it('a virada do dia em UTC ainda é o dia anterior em São Paulo', () => {
    expect(formatarDataHoraAlerta(new Date('2026-11-12T01:30:00.000Z'))).toBe('11/11/2026, 22:30');
  });
});
