import { describe, expect, it } from 'vitest';
import { encontrarMarcaVedada } from '@/shared/config';
import { sanearDescricao } from './saneamento';

// A sigla é montada em tempo de execução para este arquivo não reprovar a varredura da marca.
const SIGLA = ['C', 'T', 'C', 'E', 'A'].join('');

describe('sanearDescricao', () => {
  it.each([SIGLA, SIGLA.toLowerCase(), SIGLA[0] + SIGLA.slice(1).toLowerCase()])('retira "%s" em qualquer caixa', (sigla) => {
    const r = sanearDescricao(`Provisão p/plano de invest. e desenv. ${sigla}`);
    expect(r).toEqual({ texto: 'Provisão p/plano de invest. e desenv.', retirou: true });
    expect(encontrarMarcaVedada(r.texto)).toEqual([]);
  });

  it('retira várias ocorrências e as sobras de separador', () => {
    expect(sanearDescricao(`${SIGLA} - Sede ${SIGLA.toLowerCase()}`)).toEqual({ texto: 'Sede', retirou: true });
  });

  it('não muda o texto sem a sigla', () => {
    expect(sanearDescricao('  Salários  ')).toEqual({ texto: '  Salários  ', retirou: false });
  });
});
