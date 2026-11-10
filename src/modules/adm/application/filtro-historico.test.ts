import { describe, expect, it } from 'vitest';
import { consultaDaUrl, lerFiltroHistorico } from './filtro-historico';

const AGORA = new Date('2026-11-04T14:00:00Z'); // 11:00 em Brasília

describe('lerFiltroHistorico (US-040)', () => {
  it('sem parâmetros: os últimos 30 dias, de 00:00 do primeiro ao fim do dia de hoje (Brasília), página 1', () => {
    const { filtro, valores } = lerFiltroHistorico({}, AGORA);
    expect(valores).toEqual({ usuario: '', funcionalidade: '', tipo: '', de: '2026-10-06', ate: '2026-11-04' });
    expect(filtro.de.toISOString()).toBe('2026-10-06T03:00:00.000Z');
    expect(filtro.ate.toISOString()).toBe('2026-11-05T02:59:59.999Z');
    expect(filtro.pagina).toBe(1);
  });

  it('o último dia entra inteiro (revisão do #329)', () => {
    const { filtro } = lerFiltroHistorico({ de: '2026-10-01', ate: '2026-10-31' }, AGORA);
    expect(filtro.ate.toISOString()).toBe('2026-11-01T02:59:59.999Z');
  });

  it('valores fora do formato são ignorados; repetidos também', () => {
    const { filtro, valores } = lerFiltroHistorico({ de: '2026-02-30', ate: 'ontem', tipo: 'APAGAR', funcionalidade: 'x; drop', pagina: '-3', usuario: ['a', 'b'] }, AGORA);
    expect(valores).toEqual({ usuario: '', funcionalidade: '', tipo: '', de: '2026-10-06', ate: '2026-11-04' });
    expect(filtro).not.toHaveProperty('tipo');
    expect(filtro.pagina).toBe(1);
  });

  it('valores válidos passam; consultaDaUrl monta a mesma busca', () => {
    const { filtro, valores } = lerFiltroHistorico({ usuario: ' ana ', funcionalidade: 'adm.usuarios', tipo: 'LOGIN', pagina: '2' }, AGORA);
    expect(filtro).toMatchObject({ usuario: 'ana', funcionalidade: 'adm.usuarios', tipo: 'LOGIN', pagina: 2 });
    expect(consultaDaUrl(valores, { pagina: '3' })).toBe('usuario=ana&funcionalidade=adm.usuarios&tipo=LOGIN&de=2026-10-06&ate=2026-11-04&pagina=3');
  });
});
