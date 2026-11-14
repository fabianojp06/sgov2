import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { Dinheiro } from '@/shared/kernel';
import { preverConta } from '../domain/previsao';

// Página da previsão de fechamento do ano (US-091; IA-10).
vi.mock('next/server', () => ({ connection: async () => undefined }));

const PROPOSTA = '0b9f1c52-3d1e-4c55-9f4e-2a8f6d1b7c11';
const MESES = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);
const serie = (v: string, ate = 12) => MESES.map((_, i) => (i < ate ? Dinheiro.de(v) : Dinheiro.zero()));
const risco = { ...preverConta(MESES, 5, { conta: '4.1.1.5.005', orcado: serie('1000'), realizado: serie('1200', 6) }), descricao: 'Material' };
const ok = { ...preverConta(MESES, 5, { conta: '4.1.1.5.007', orcado: serie('100'), realizado: serie('100', 6) }), descricao: 'Serviços' };
let liberada = false;

vi.mock('@/modules/orc', async (original) => {
  const { exigir } = await import('@/shared/authz');
  return {
    ...(await original<typeof import('@/modules/orc')>()),
    iaLiberada: async () => liberada,
    obterPrevisaoFechamento: async (ctx: ContextoRequisicao, f: { proposta?: string }) => {
      exigir(ctx, 'orc.oxr', 'consultar');
      const propostas = [{ id: PROPOSTA, numero: 'TP-P01/2026', objeto: 'Programa A' }];
      if (!f.proposta) return { propostas, tela: null, erro: null };
      return {
        propostas,
        erro: null,
        tela: {
          propostaId: PROPOSTA,
          unidadeId: 'u',
          numero: 'TP-P01/2026',
          objeto: 'Programa A',
          versaoOficial: 1,
          ano: 2026,
          anos: [2026, 2027],
          mesCorte: '2026-06',
          contas: [risco, ok],
          total: preverConta(MESES, 5, { conta: 'Total', orcado: serie('1100'), realizado: serie('1300', 6) }),
          semPessoal: true,
        },
      };
    },
  };
});

const { default: Previsao } = await import('../../../app/(sistema)/orc/orcado-realizado/previsao/page');

const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: 'u1', usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];
const pagina = async (busca: Record<string, string> = {}) => renderToStaticMarkup(await Previsao({ searchParams: Promise.resolve(busca) }));

beforeEach(() => {
  negacoes = [];
  liberada = false;
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e);
  });
});

describe('página da previsão de fechamento', () => {
  it('a conta em risco com o desvio e o mês do estouro em vermelho; a tendência; o corte; sem a IA ligada, sem o botão', async () => {
    contexto = ctx(['orc.oxr:consultar']);
    const h = await pagina({ proposta: PROPOSTA });
    expect(h).toContain('Realizado carregado até 06/2026');
    expect(h).toContain('1 conta(s) com risco de estouro no ano.');
    expect(h).toContain('<th scope="row">4.1.1.5.005 Material</th><td>12.000,00</td><td>7.200,00</td><td>120,00%</td><td>14.400,00</td><td style="color:#cf222e;font-weight:bold">2.400,00</td><td style="color:#cf222e;font-weight:bold">11/2026</td>');
    expect(h).toContain('<td>0,00</td><td>Não</td>');
    expect(h).toContain('As contas de pessoal não aparecem para o seu perfil.');
    expect(h).not.toContain('Pedir à IA');
  });

  it('com a IA ligada: o botão do destaque', async () => {
    contexto = ctx(['orc.oxr:consultar', 'orc.ia_previsao:executar']);
    liberada = true;
    expect(await pagina({ proposta: PROPOSTA })).toContain('Pedir à IA o destaque das contas em risco');
  });

  it('sem a permissão do Orçado x Realizado: 404', async () => {
    contexto = ctx(['orc.realizado:consultar']);
    await expect(pagina()).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(negacoes).toHaveLength(1);
  });
});
