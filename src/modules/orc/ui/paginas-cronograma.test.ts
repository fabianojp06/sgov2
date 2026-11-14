import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { Dinheiro } from '@/shared/kernel';
import type { CronogramaTela } from '../application/cronograma';
import { montarCronograma } from '../domain/cronograma';
import { MENSAGENS_ORC as M } from '../domain/mensagens';

// Página do cronograma de desembolso (US-075; plano do P25, Task 2, Step 1).
vi.mock('next/server', () => ({ connection: async () => undefined }));
const P1 = '00000000-0000-4000-8000-0000000000b1';
const M1 = '00000000-0000-4000-8000-0000000000c1';
const caso = vi.hoisted(() => ({ filtros: [] as unknown[] }));

const competencias = ['2027-11', '2027-12', '2028-01'];
const dados = (): CronogramaTela => ({
  propostaId: P1,
  numero: 'TP-2027/001',
  objeto: 'Programa de capacitação',
  tipo: 'TERMO_PARCERIA',
  versaoNumero: 2,
  situacao: 'RASCUNHO',
  meta: 'Todos',
  metas: [{ id: M1, rotulo: 'M1 – Oficinas' }],
  linhas: montarCronograma(competencias, new Map(competencias.map((c) => [c, Dinheiro.de('100.00')])), Dinheiro.de('300.00')),
  anos: ['2027', '2028'],
  porConta: [{ conta: '4.1.1.5.005', descricao: 'Material', anos: { '2027': Dinheiro.de('200.00'), '2028': Dinheiro.de('100.00') }, total: Dinheiro.de('300.00') }],
  total: Dinheiro.de('300.00'),
  valorGlobal: Dinheiro.de('300.00'),
  avisos: [],
  semPessoal: true,
  pessoalNaoHomologado: false,
  viagensDistribuidas: true,
});

vi.mock('@/modules/orc', async (original) => {
  const { exigir } = await import('@/shared/authz');
  return {
    ...(await original<typeof import('@/modules/orc')>()),
    obterCronograma: async (ctx: ContextoRequisicao, id: string, filtros: unknown) => {
      exigir(ctx, 'orc.cronograma', 'consultar');
      caso.filtros.push(filtros);
      return id === P1 ? dados() : null;
    },
    propostasParaCronograma: async (ctx: ContextoRequisicao) => {
      exigir(ctx, 'orc.cronograma', 'consultar');
      return [{ id: P1, numero: 'TP-2027/001', objeto: 'Programa de capacitação', tipo: 'Termo de Parceria' }];
    },
  };
});

const { default: Cronograma } = await import('../../../app/(sistema)/orc/cronograma/page');

const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: 'u1', usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];

beforeEach(() => {
  caso.filtros = [];
  negacoes = [];
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e);
  });
});

const digest = (p: Promise<unknown>) =>
  p.then(
    () => 'sem erro',
    (e: { digest?: string }) => e.digest ?? String(e),
  );
const html = async (busca: Record<string, string> = {}) => renderToStaticMarkup(await Cronograma({ searchParams: Promise.resolve(busca) }));

describe('página do cronograma de desembolso', () => {
  it('as parcelas, o fechamento de cada ano, o % e o repasse; a previsão por conta; os avisos; sem campo editável', async () => {
    contexto = ctx(['orc.cronograma:consultar']);
    const h = await html({ proposta: P1, meta: M1 });
    expect(caso.filtros).toEqual([{ meta: M1 }]);
    expect(h).toContain('<th scope="row">Parcela 1 – 11/2027</th><td>100,00</td><td>100,00</td><td>33,33%</td><td>-</td>');
    expect(h).toContain('<th scope="row">Total de 2027</th><td>200,00</td><td>200,00</td><td>66,67%</td><td>-</td>');
    expect(h).toContain('<th scope="row">Parcela 3 – 01/2028</th><td>100,00</td><td>300,00</td><td>100,00%</td><td>300,00</td>');
    expect(h).toContain('<th scope="row">4.1.1.5.005 – Material</th><td>200,00</td><td>100,00</td><td>300,00</td>');
    expect(h).toContain(M.TOTALIZADOR_SEM_PESSOAL);
    expect(h).toContain(M.CRONOGRAMA_VIAGENS_DISTRIBUIDAS);
    expect(h).toMatch(/<option value=""[^>]*>Todos<\/option>/);
    expect(h).not.toContain('<input name=');
  });

  it('sem proposta: a lista; sem permissão: 404', async () => {
    contexto = ctx(['orc.cronograma:consultar']);
    expect(await html()).toContain(`<a href="/orc/cronograma?proposta=${P1}">Cronograma de desembolso da proposta TP-2027/001 – Programa de capacitação</a>`);
    contexto = ctx(['orc.propostas:consultar']);
    expect(await digest(html())).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(negacoes).toHaveLength(1);
  });
});
