import { describe, expect, it } from 'vitest';
import { textoAvaliacao } from './cadastro-ia';

describe('texto da avaliação de qualidade', () => {
  const base = { criadoEm: '2026-11-11T18:00:00.000Z', concluidoEm: '2026-11-11T18:05:00.000Z', erro: null };
  it('sem avaliação, pendente, falha e concluída', () => {
    expect(textoAvaliacao(null)).toBe('Ainda não avaliado.');
    expect(textoAvaliacao({ ...base, situacao: 'PENDENTE', concluidoEm: null, total: null, acertos: null })).toBe('Avaliação pedida em 11/11/2026, 15:00, em andamento.');
    expect(textoAvaliacao({ ...base, situacao: 'FALHOU', total: null, acertos: null, erro: 'A IA está desligada para esta função.' })).toMatch(/falhou: A IA está desligada/);
    expect(textoAvaliacao({ ...base, situacao: 'CONCLUIDA', total: 40, acertos: 31 })).toBe('Última avaliação (11/11/2026, 15:05): 31 de 40 acertos (77,5%).');
    expect(textoAvaliacao({ ...base, situacao: 'CONCLUIDA', total: 0, acertos: 0 })).toMatch(/0 de 0 acertos \(—\)/);
  });
});
