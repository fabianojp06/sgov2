import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import type { CargoTela } from '../domain/cargo-tela';
import { camposIniciais, COR_DESVIO, FormCargo, montarEnvioCargo } from './form-cargo';
import { ListaCargos } from './lista-cargos';

// Telas de cargo (plano do P4, Task 12b, Step 1).
vi.mock('next/server', () => ({ connection: async () => undefined }));
const falso = vi.hoisted(() => ({ cargo: null as CargoTela | null }));
vi.mock('@/modules/cad', async (original) => ({
  ...(await original<typeof import('@/modules/cad')>()),
  obterCargo: async () => falso.cargo,
  listarCargos: async () => [],
}));
const { default: PaginaCargo } = await import('../../../app/(sistema)/cad/cargos/[id]/page');
const { default: PaginaImportar } = await import('../../../app/(sistema)/cad/cargos/importar/page');

const aberto: CargoTela = {
  id: '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c',
  codigo: 'C1',
  nomeOficial: 'Analista',
  nomeMercado: 'Analista Pleno',
  tabelaSalarial: 'T1 — Tabela 1',
  faixa: 'F1 — Faixa 1',
  nivel: 'N1 — Nível 1',
  salarios: { minimo: '6000.00', maximo: '9000.00', funcaoGratificada: '1200.00', real: '7500.00', definido: null },
  mascarado: false,
  origemMercado: 'Editado manualmente',
  fonteAtiva: 'TOTAL',
  salarioDaFonte: '10200.00',
  adicional: null,
  desvioDeMercado: 'DENTRO',
  salariosIlegiveis: false,
  ativo: true,
  versao: 2,
};
const mascarado: CargoTela = {
  ...aberto,
  mascarado: true,
  salarios: { minimo: null, maximo: null, funcaoGratificada: null, real: null, definido: null },
  salarioDaFonte: null,
  desvioDeMercado: null,
};
const ok = async () => ({ ok: true as const, valor: { versao: 3 } });
const html = (c: CargoTela, podeAlterar = true) => renderToString(createElement(FormCargo, { cargo: c, podeAlterar, alterar: ok }));

describe('FormCargo (SSR)', () => {
  it('os campos do Rubi desabilitados; as 5 fontes; o desvio com cor e texto', () => {
    const h = html(aberto);
    expect(h).toMatch(/<fieldset disabled=""><legend>Dados do Rubi \(só a importação muda\)<\/legend>/);
    expect(h).toMatch(/<input id="cargo-tabela"(?=[^>]*readOnly="")(?=[^>]*value="T1 — Tabela 1")/);
    for (const f of ['MINIMO', 'MAXIMO', 'TOTAL', 'REAL', 'DEFINIDO']) expect(h).toContain(`<option value="${f}"`);
    expect(h).toContain(`color:${COR_DESVIO.DENTRO}`);
    expect(h).toContain('Dentro do mercado');
    expect(h).toContain('>Salvar</button>');
    // Exibição em pt-BR.
    expect(h).toContain('R$ 10.200,00');
    expect(h).not.toContain('Avise o administrador');
    expect(html({ ...aberto, salariosIlegiveis: true })).toContain('Avise o administrador');
  });

  it('mascarado (R24): nenhum valor no HTML, o aviso, e sem os campos de salário', () => {
    const h = html(mascarado);
    expect(h).not.toMatch(/7500|6000|9000|1200|10200/);
    expect(h).toContain('Os salários ficam mascarados');
    expect(h).not.toContain('cargo-funcaoGratificada');
  });

  it('o envio leva os salários só quando a tela os mostra', () => {
    expect(montarEnvioCargo(aberto, 2, camposIniciais(aberto))).toMatchObject({ funcaoGratificada: '1200.00', salarioDefinido: null, fonteAtiva: 'TOTAL', versao: 2 });
    const envio = montarEnvioCargo(mascarado, 2, camposIniciais(mascarado));
    expect('funcaoGratificada' in envio || 'salarioDefinido' in envio).toBe(false);
    expect(montarEnvioCargo(aberto, 2, { ...camposIniciais(aberto), adicional: 'INSALUBRIDADE', grau: 'MEDIO' })).toMatchObject({ periculosidade: false, insalubridade: 'MEDIO' });
  });

  it('sem poder alterar: sem Salvar', () => {
    expect(html(aberto, false)).not.toContain('Salvar');
  });
});

describe('ListaCargos (SSR)', () => {
  it('sem botão Novo; mascarado aparece como "mascarado"; o regravar só com executar', () => {
    const h = renderToString(createElement(ListaCargos, { cargos: [mascarado], escopoSessao: 'x', podeRegravar: false }));
    expect(h).not.toMatch(/>(Novo|Incluir)</);
    expect(h).toContain('mascarado');
    expect(h).not.toContain('Regravar salários');
    const comRegravar = renderToString(createElement(ListaCargos, { cargos: [aberto], escopoSessao: 'x', podeRegravar: true, regravar: async () => ({ ok: true as const, valor: { manuais: 0, cargaId: null } }) }));
    expect(comRegravar).toContain('Regravar salários com a chave atual');
  });
});

describe('páginas de cargo', () => {
  let contexto: ContextoRequisicao;
  // "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: as permissões saem daqui.
  const ctx = (...p: [string, string][]): ContextoRequisicao => ({ usuarioId: aberto.id, usuarioRotulo: 'u', sessaoUid: 's', ip: null, permissoes: new Set(p.map(([f, a]) => `${f}:${a}`)) });
  const digest = (p: Promise<unknown>) => p.then(() => 'sem erro', (e: { digest?: string }) => e.digest ?? String(e));
  const render = async (p: Promise<unknown>) => renderToString((await p) as Parameters<typeof renderToString>[0]);
  const params = Promise.resolve({ id: aberto.id });
  beforeEach(() => {
    limparJanelaNegacoes();
    configurarProvedorContexto({ obter: async () => contexto });
    configurarAuditorNegacao(async () => undefined);
  });

  it('importar exige executar', async () => {
    contexto = ctx(['cad.cargos', 'consultar']);
    expect(await digest(PaginaImportar())).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
  });

  it('o cargo: "Salvar" só com alterar e salários; cargo que não existe → 404', async () => {
    falso.cargo = aberto;
    contexto = ctx(['cad.cargos', 'consultar'], ['cad.cargos', 'alterar']);
    expect(await render(PaginaCargo({ params }))).not.toContain('>Salvar</button>');
    contexto = ctx(['cad.cargos', 'consultar'], ['cad.cargos', 'alterar'], ['cad.salarios', 'consultar']);
    expect(await render(PaginaCargo({ params }))).toContain('>Salvar</button>');
    falso.cargo = null;
    expect(await digest(PaginaCargo({ params }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
  });
});
