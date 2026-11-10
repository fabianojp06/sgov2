import { describe, expect, it } from 'vitest';
import { alternarFuncionalidade, alternarPerfil, estadoInicial, mensagemPerfilDesmarcado } from './painel-funcionalidades';

const ORC = { codigo: 'ORCAMENTISTA', funcionalidades: [{ codigo: 'cad.um' }, { codigo: 'cad.dois' }], fixas: [] };
const ADM = { codigo: 'ADMINISTRADOR', funcionalidades: [{ codigo: 'cad.um' }], fixas: [{ codigo: 'adm.usuarios' }] };

describe('painel Funcionalidade(s) do Perfil (US-039)', () => {
  it('estado inicial com as exceções do usuário', () => {
    const e = estadoInicial(['ORCAMENTISTA'], [{ perfil: 'ORCAMENTISTA', funcionalidade: 'cad.um' }]);
    expect([...e.perfis]).toEqual(['ORCAMENTISTA']);
    expect([...e.retiradas]).toEqual(['ORCAMENTISTA:cad.um']);
  });

  it('desmarcar uma funcionalidade cria a exceção; marcar de novo a desfaz (A4, A5, A6)', () => {
    const inicio = estadoInicial(['ORCAMENTISTA'], []);
    const r = alternarFuncionalidade(inicio, ORC, 'cad.um', false);
    expect(r.perfilDesmarcado).toBe(false);
    expect([...r.estado.retiradas]).toEqual(['ORCAMENTISTA:cad.um']);
    expect([...alternarFuncionalidade(r.estado, ORC, 'cad.um', true).estado.retiradas]).toEqual([]);
  });

  it('REQ0081: a última desmarcada desmarca o perfil, que perde as exceções', () => {
    const um = alternarFuncionalidade(estadoInicial(['ORCAMENTISTA', 'GFIN'], []), ORC, 'cad.um', false).estado;
    const r = alternarFuncionalidade(um, ORC, 'cad.dois', false);
    expect(r.perfilDesmarcado).toBe(true);
    expect([...r.estado.perfis]).toEqual(['GFIN']);
    expect([...r.estado.retiradas]).toEqual([]);
  });

  it('perfil com funcionalidade fixa (Administração) nunca é desmarcado', () => {
    const r = alternarFuncionalidade(estadoInicial(['ADMINISTRADOR'], []), ADM, 'cad.um', false);
    expect(r.perfilDesmarcado).toBe(false);
    expect([...r.estado.perfis]).toEqual(['ADMINISTRADOR']);
    expect([...r.estado.retiradas]).toEqual(['ADMINISTRADOR:cad.um']);
  });

  it('desmarcar e remarcar o perfil: as funcionalidades voltam todas marcadas', () => {
    const comExcecao = estadoInicial(['ORCAMENTISTA'], [{ perfil: 'ORCAMENTISTA', funcionalidade: 'cad.um' }]);
    const fora = alternarPerfil(comExcecao, 'ORCAMENTISTA', false);
    expect([...fora.perfis]).toEqual([]);
    const volta = alternarPerfil(fora, 'ORCAMENTISTA', true);
    expect([...volta.perfis]).toEqual(['ORCAMENTISTA']);
    expect([...volta.retiradas]).toEqual([]);
  });

  it('aviso da REQ0081 [PROVISÓRIO]', () =>
    expect(mensagemPerfilDesmarcado('Orçamentista')).toBe('Perfil Orçamentista desmarcado: todas as funcionalidades foram retiradas.'));
});
