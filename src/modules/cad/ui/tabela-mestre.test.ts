import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { ITEM_NOVO, TabelaMestre, type ItemTela } from './tabela-mestre';

// Tela da Tabela Mestre: inclusão pela tela e seletor de ano (US-050).
vi.mock('next/server', () => ({ connection: async () => undefined }));
const falso = vi.hoisted(() => ({ anos: [2028, 2027] as number[] }));
vi.mock('@/modules/cad', async (original) => ({
  ...(await original<typeof import('@/modules/cad')>()),
  listarAnosBeneficios: async () => falso.anos,
  listarBeneficiosMestre: async () => [],
}));
const { default: Pagina } = await import('../../../app/(sistema)/cad/beneficios/page');

const item: ItemTela = {
  codigo: 'beneficio.vr',
  nome: 'Vale-refeição',
  forma: 'VALOR_DIARIO',
  valor: '36.50',
  percentual: null,
  conta: '4.1.1.1.009',
  padraoPosicao: true,
  ativo: true,
  provisorio: false,
  versao: 1,
};
const ok = async () => ({ ok: true as const });
const html = (props: Partial<Parameters<typeof TabelaMestre>[0]> = {}) =>
  renderToString(createElement(TabelaMestre, { ano: 2027, itens: [item], podeAlterar: false, alterar: ok, ...props }));

describe('TabelaMestre (SSR)', () => {
  it('"Incluir benefício" só com a permissão de incluir e a ação', () => {
    expect(html()).not.toContain('Incluir benefício');
    expect(html({ podeIncluir: true })).not.toContain('Incluir benefício');
    expect(html({ podeIncluir: true, incluir: ok })).toContain('>Incluir benefício</button>');
  });

  it('o item novo começa com o prefixo do código, valor mensal e ativo', () => {
    expect(ITEM_NOVO).toMatchObject({ codigo: 'beneficio.', forma: 'VALOR_MENSAL', ativo: true, padraoPosicao: false, valor: null });
  });
});

describe('página /cad/beneficios', () => {
  let contexto: ContextoRequisicao;
  // "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: as permissões saem daqui.
  const ctx = (...acoes: string[]): ContextoRequisicao => ({
    usuarioId: '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c',
    usuarioRotulo: 'grh',
    sessaoUid: 's',
    ip: null,
    permissoes: new Set(acoes.map((a) => `cad.beneficios:${a}`)),
  });
  const pagina = async (ano?: string) =>
    renderToString((await Pagina({ searchParams: Promise.resolve(ano ? { ano } : {}) })) as Parameters<typeof renderToString>[0]);
  beforeEach(() => {
    falso.anos = [2028, 2027];
    limparJanelaNegacoes();
    configurarProvedorContexto({ obter: async () => contexto });
    configurarAuditorNegacao(async () => undefined);
  });

  it('sem ?ano, o exercício mais recente, com o seletor de ano', async () => {
    contexto = ctx('consultar');
    const h = await pagina();
    expect(h).toContain('Tabela Mestre de Benefícios <!-- -->2028');
    expect(h).toMatch(/<form action="\/cad\/beneficios" method="get">/);
    expect(h).toContain('<option value="2028" selected="">2028</option>');
  });

  it('incluir só com a permissão e num exercício com parâmetros', async () => {
    contexto = ctx('consultar', 'incluir');
    expect(await pagina('2027')).toContain('Incluir benefício');
    expect(await pagina('2031')).not.toContain('Incluir benefício');
    expect(await pagina('2031')).toContain('O exercício <!-- -->2031<!-- --> não tem parâmetros.');
    contexto = ctx('consultar');
    expect(await pagina('2027')).not.toContain('Incluir benefício');
  });

  it('nenhum exercício com parâmetros: a mensagem, sem a tabela', async () => {
    falso.anos = [];
    contexto = ctx('consultar', 'incluir');
    const h = await pagina();
    expect(h).toContain('Nenhum exercício tem parâmetros ainda.');
    expect(h).not.toContain('Incluir benefício');
  });
});
