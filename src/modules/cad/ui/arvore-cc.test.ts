import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { nosVisiveis, paraNoTelaCc, textoVazioCc, type NoCcTela } from '../domain/arvore-tela';
import type { NoCentroCusto } from '../domain/estrutura';
import { ArvoreCc } from './arvore-cc';
import { CamposAprovacaoDirex } from './importar-cc';

// Telas de centros de custo (plano do P4, Task 8, Step 1).
vi.mock('next/server', () => ({ connection: async () => undefined }));
vi.mock('@/modules/cad', async (original) => ({ ...(await original<typeof import('@/modules/cad')>()), consultarArvoreCentrosCusto: async () => [] }));
const { default: Importar } = await import('../../../app/(sistema)/cad/centros-custo/importar/page');
const { default: Consulta } = await import('../../../app/(sistema)/cad/centros-custo/page');

const cc = (classificacao: string, extra: Partial<NoCentroCusto> = {}): NoCentroCusto => ({
  classificacao,
  codigoReduzido: '14.370',
  descricao: `CC ${classificacao}`,
  nivel: classificacao.split('.').length as NoCentroCusto['nivel'],
  tipo: 'ANALITICO',
  ativo: true,
  deGestao: false,
  natureza: null,
  provisorio: false,
  filhos: [],
  ...extra,
});

describe('paraNoTelaCc', () => {
  it('selos de gestão (R17) e de provisório (GAP-CC-001), e a situação', () => {
    expect(paraNoTelaCc(cc('4.3.0', { deGestao: true })).linha).toMatchObject({ reduzido: '14.370', tipo: 'Analítico', selos: 'Gestão', situacao: 'Ativo' });
    expect(paraNoTelaCc(cc('4.3.1', { deGestao: true, provisorio: true })).linha.selos).toBe('Gestão · Provisório');
    expect(paraNoTelaCc(cc('4.3.2')).linha.selos).toBeNull();
    expect(paraNoTelaCc(cc('4.3.3', { ativo: false })).linha.situacao).toBe('Inativo');
  });

  it('"Mostrar inativos" e o texto da grade vazia', () => {
    const nos = [paraNoTelaCc(cc('1', { tipo: 'SINTETICO', filhos: [cc('1.1')] })), paraNoTelaCc(cc('2', { ativo: false }))];
    expect(nosVisiveis(nos, false).map((n) => n.id)).toEqual(['1']);
    expect(nosVisiveis(nos, true).map((n) => n.id)).toEqual(['1', '2']);
    expect(textoVazioCc([])).toMatch(/^Nenhum centro de custo cadastrado/);
    expect(textoVazioCc(nos)).toMatch(/^Nenhum centro de custo ativo/);
  });
});

describe('ArvoreCc (SSR)', () => {
  const raiz: NoCcTela = paraNoTelaCc(cc('9', { codigoReduzido: '99.001', provisorio: true, deGestao: true }));
  it('o reduzido ao lado da classificação, os selos, e sem Novo, Alterar ou Excluir', () => {
    const html = renderToString(createElement(ArvoreCc, { nos: [raiz], escopoSessao: 'abc' }));
    expect(html).toMatch(/>Classificação<\/th><th[^>]*>Reduzido<\/th>/);
    expect(html).toContain('99.001');
    expect(html).toContain('Gestão · Provisório');
    expect(html).not.toMatch(/>(Novo|Incluir|Alterar|Excluir)</);
    expect(html).toContain('Mostrar inativos');
  });
});

describe('CamposAprovacaoDirex (SSR)', () => {
  it('com a carga provisória: o aviso "Carga provisória (minuta)" e os campos opcionais', () => {
    const html = renderToString(createElement(CamposAprovacaoDirex, { provisoriaPermitida: true }));
    expect(html).toContain('Carga provisória (minuta).');
    expect(html).not.toContain('required');
  });

  it('sem ela: data e documento obrigatórios, sem o aviso', () => {
    const html = renderToString(createElement(CamposAprovacaoDirex, { provisoriaPermitida: false }));
    expect(html).not.toContain('Carga provisória');
    expect(html).toMatch(/<input id="aprovacao-data" type="date" required="" name="aprovacaoData"\/>/);
    expect(html).toMatch(/<input id="aprovacao-documento" type="text" maxLength="120" required="" name="aprovacaoDocumento"\/>/);
  });
});

describe('páginas de centros de custo', () => {
  let contexto: ContextoRequisicao;
  // "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: as permissões saem daqui.
  const ctx = (...acoes: string[]): ContextoRequisicao => ({
    usuarioId: '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c',
    usuarioRotulo: 'u',
    sessaoUid: 's1',
    ip: null,
    permissoes: new Set(acoes.map((a) => `cad.centros_custo:${a}`)),
  });
  const html = async (p: Promise<unknown>) => renderToString((await p) as Parameters<typeof renderToString>[0]);
  const digest = (p: Promise<unknown>) => p.then(() => 'sem erro', (e: { digest?: string }) => e.digest ?? String(e));
  beforeEach(() => {
    limparJanelaNegacoes();
    configurarProvedorContexto({ obter: async () => contexto });
    configurarAuditorNegacao(async () => undefined);
    vi.stubEnv('AMBIENTE', 'hml');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('importar exige executar; "Importar arquivo" na consulta só com executar', async () => {
    contexto = ctx('consultar');
    expect(await digest(Importar())).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(await html(Consulta())).not.toContain('Importar arquivo');
    contexto = ctx('consultar', 'executar');
    expect(await html(Consulta())).toContain('href="/cad/centros-custo/importar"');
  });

  it.each([
    ['1', true],
    ['0', false],
    ['true', false],
  ])('CC_CARGA_PROVISORIA=%j em hml: aviso da carga provisória = %s', async (valor, aviso) => {
    vi.stubEnv('CC_CARGA_PROVISORIA', valor);
    contexto = ctx('consultar', 'executar');
    expect((await html(Importar())).includes('Carga provisória (minuta)')).toBe(aviso);
  });
});
