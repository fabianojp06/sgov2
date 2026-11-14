import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { Dinheiro } from '@/shared/kernel';
import { montarGradeOxr } from '../application/grade-oxr';

// Página do Orçado x Realizado (US-086, parte 1; OxR V2, seção 5).
vi.mock('next/server', () => ({ connection: async () => undefined }));

const PROPOSTA = '0b9f1c52-3d1e-4c55-9f4e-2a8f6d1b7c11';
const plano = [
  {
    classificacao: '4.1.1.5',
    descricao: 'ADMINISTRATIVAS',
    nivel: 4,
    tipo: 'SINTETICA' as const,
    filhos: [
      { classificacao: '4.1.1.5.005', descricao: 'Material', nivel: 5, tipo: 'ANALITICA' as const, filhos: [] },
      { classificacao: '4.1.1.5.007', descricao: 'Serviços', nivel: 5, tipo: 'ANALITICA' as const, filhos: [] },
    ],
  },
];
const grade = montarGradeOxr(
  plano,
  ['2018-09', '2018-10'],
  new Map([['4.1.1.5.005|2018-09', Dinheiro.de('704831.00')], ['4.1.1.5.005|2018-10', Dinheiro.de('540656.00')]]),
  new Map([['4.1.1.5.005|2018-09', Dinheiro.de('569413.56')], ['4.1.1.5.005|2018-10', Dinheiro.de('713183.14')], ['4.1.1.5.007|2018-10', Dinheiro.de('10.00')]]),
  { zeradas: false },
);

vi.mock('@/modules/orc', async (original) => {
  const { exigir } = await import('@/shared/authz');
  return {
    ...(await original<typeof import('@/modules/orc')>()),
    iaLiberada: async () => false,
    obterOrcadoRealizado: async (ctx: ContextoRequisicao, f: { proposta?: string }) => {
      exigir(ctx, 'orc.oxr', 'consultar');
      const propostas = [{ id: PROPOSTA, numero: 'TP-X01/2026', objeto: 'Programa A' }];
      if (!f.proposta) return { propostas, tela: null, erro: f.proposta === '' ? 'Selecione um Termo de Parceria para consultar.' : null };
      return {
        propostas,
        erro: null,
        tela: {
          propostaId: PROPOSTA,
          numero: 'TP-X01/2026',
          objeto: 'Programa A',
          versaoOficial: 2,
          vigencia: { inicio: '2018-01', fim: '2019-12' },
          filtros: { de: '2018-09', ate: '2018-10', conta: '', zeradas: false },
          meses: ['2018-09', '2018-10'],
          grade,
          pendencias: { quantidade: 2, valor: Dinheiro.de('15') },
          ajustes: [],
          atualizadoEm: null,
          semPessoal: true,
          pessoalNaoHomologado: false,
        },
      };
    },
  };
});

const { default: OrcadoRealizado } = await import('../../../app/(sistema)/orc/orcado-realizado/page');

const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: 'u1', usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];
const pagina = async (busca: Record<string, string> = {}) => renderToStaticMarkup(await OrcadoRealizado({ searchParams: Promise.resolve(busca) }));

beforeEach(() => {
  negacoes = [];
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e);
  });
});

describe('página do Orçado x Realizado', () => {
  it('sem TP: só os filtros; TP vazio: E1', async () => {
    contexto = ctx(['orc.oxr:consultar']);
    const h = await pagina();
    expect(h).toContain('TP-X01/2026 – Programa A');
    expect(h).not.toContain('<caption');
    expect(await pagina({ proposta: '' })).toContain('Selecione um Termo de Parceria para consultar.');
  });

  it('a grade: meses Mmm/AA, % do mês, estouro em vermelho e negrito, Sem orçamento, total do período com saldo; E3 com link', async () => {
    contexto = ctx(['orc.oxr:consultar']);
    const h = await pagina({ proposta: PROPOSTA });
    expect(h).toContain('>Set/18</th>');
    expect(h).toContain('>Out/18</th>');
    // RN0314 por célula: 80,79% sem destaque; 131,91% e o total de 102,98% em vermelho e negrito.
    expect(h).toContain('<td>704.831,00</td><td>569.413,56</td><td>80,79%</td>');
    expect(h).toContain('<td>540.656,00</td><td>713.183,14</td><td><strong style="color:#cf222e" data-estouro="sim">131,91%</strong></td>');
    expect(h).toContain('Sem orçamento');
    expect(h).toContain('<td>1.245.487,00</td><td>1.282.596,70</td><td>-37.109,70</td><td><strong style="color:#cf222e" data-estouro="sim">102,98%</strong></td>');
    expect(h.match(/<tfoot>.*<\/tfoot>/s)?.[0]).toContain('data-estouro="sim"');
    expect(h).toContain('Existem 2 valores do ERP sem conta correspondente no SGO (R$ 15,00).');
    // Sem orc.realizado:consultar, o aviso fica sem o link (a página dele daria 404).
    expect(h).not.toContain(`href="/orc/realizado?proposta=${PROPOSTA}"`);
    expect(h).toContain('As contas de pessoal não aparecem para o seu perfil');
    expect(h).not.toContain('Atualizar Realizado');
    expect(h).not.toContain('Exportar XLSX');
  });

  it('com exportar: os links de XLSX e PDF levam os filtros da tela', async () => {
    contexto = ctx(['orc.oxr:consultar', 'orc.oxr:exportar']);
    const h = await pagina({ proposta: PROPOSTA });
    expect(h).toContain(`href="/orc/orcado-realizado/exportar?proposta=${PROPOSTA}&amp;de=2018-09&amp;ate=2018-10&amp;zeradas=nao&amp;formato=xlsx"`);
    expect(h).toContain('formato=pdf"');
  });

  it('quem carrega o realizado vê o link Atualizar Realizado (A1)', async () => {
    contexto = ctx(['orc.oxr:consultar', 'orc.realizado:consultar', 'orc.realizado:executar']);
    const h = await pagina({ proposta: PROPOSTA });
    expect(h).toContain('Atualizar Realizado');
    expect(h).toContain('Ver a lista');
  });

  it('sem a permissão: 404', async () => {
    contexto = ctx(['orc.realizado:consultar']);
    await expect(pagina()).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(negacoes).toHaveLength(1);
  });
});
