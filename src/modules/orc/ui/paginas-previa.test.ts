import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { Dinheiro } from '@/shared/kernel';
import type { PreVisualizacao } from '../application/pre-visualizacao';
import { MENSAGENS_ORC as M } from '../domain/mensagens';
import { montarArvore } from '../domain/totalizador';

// Página da pré-visualização da proposta (US-068; plano do P29, Task 1).
vi.mock('next/server', () => ({ connection: async () => undefined }));
const P1 = '00000000-0000-4000-8000-0000000000b1';
const caso = vi.hoisted(() => ({ categoria: 'META' as 'META' | 'CONSOLIDADA', semPessoal: false }));

const plano = [
  {
    classificacao: '4',
    descricao: 'DESPESAS',
    nivel: 1,
    tipo: 'SINTETICA' as const,
    filhos: [{ classificacao: '4.1.1.5.005', descricao: 'Material', nivel: 5, tipo: 'ANALITICA' as const, filhos: [] }],
  },
];
const dados = (): PreVisualizacao => ({
  propostaId: P1,
  numero: 'TP-2027/001',
  objeto: 'Programa de capacitação',
  parceiro: 'Prefeitura',
  tipo: 'TERMO_PARCERIA',
  categoria: caso.categoria,
  versaoNumero: 2,
  situacao: 'RASCUNHO',
  vigencia: { inicio: '2027-01', fim: '2027-12' },
  valorGlobal: Dinheiro.de('5600.00'),
  metas: [{ numero: 'M1', nome: 'Oficinas', valor: Dinheiro.de('5600.00'), ativa: true }],
  quantitativos: [{ documento: 'AP-1', inicio: '2027-01', fim: '2027-06', quantidades: { EMPREGADO: 2, ESTAGIARIO: 1, JOVEM_APRENDIZ: 0 } }],
  totaisQuantitativos: { EMPREGADO: 2, ESTAGIARIO: 1, JOVEM_APRENDIZ: 0 },
  arvore: montarArvore(plano, () => Dinheiro.de('5600.00')),
  origens: { '4.1.1.5.005': ['VIAGENS', 'BENS'] },
  foraDoPlano: [],
  avisos: [],
  semPessoal: caso.semPessoal,
});

vi.mock('@/modules/orc', async (original) => {
  const { exigir } = await import('@/shared/authz');
  return {
    ...(await original<typeof import('@/modules/orc')>()),
    obterPreVisualizacao: async (ctx: ContextoRequisicao, id: string) => {
      exigir(ctx, 'orc.propostas', 'consultar');
      return id === P1 ? dados() : null;
    },
  };
});

const { default: Previa } = await import('../../../app/(sistema)/orc/previa/page');

const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: 'u1', usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];

beforeEach(() => {
  caso.categoria = 'META';
  caso.semPessoal = false;
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
const html = async (busca: Record<string, string>) => renderToStaticMarkup(await Previa({ searchParams: Promise.resolve(busca) }));

describe('página da pré-visualização da proposta', () => {
  it('as seções na ordem do UC03.38, com os totais, a origem e o rodapé', async () => {
    contexto = ctx(['orc.propostas:consultar']);
    const h = await html({ proposta: P1 });
    const ordem = ['>Proposta<', '>Metas<', '>Empregados<', '>Contas<', 'Relatório de Pré-Visualização do TP · TP-2027/001'].map((x) => h.indexOf(x));
    expect(ordem.every((i) => i >= 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(h).toContain('01/2027 a 12/2027');
    expect(h).toContain('R$ 5.600,00');
    expect(h).toContain('M1 – Oficinas');
    expect(h).toContain('Viagens, Bens');
    expect(h).toContain('Total por categoria');
    expect(h).toContain('Imprimir');
  });

  it('Consolidada sem a seção de metas (Review Focus 4); sem o pessoal, a nota', async () => {
    contexto = ctx(['orc.propostas:consultar']);
    caso.categoria = 'CONSOLIDADA';
    caso.semPessoal = true;
    const h = await html({ proposta: P1 });
    expect(h).not.toContain('>Metas<');
    expect(h).toContain(M.TOTALIZADOR_SEM_PESSOAL);
  });

  it('proposta fora dos TPs do usuário, id ausente e sem permissão: 404 (Review Focus 2)', async () => {
    contexto = ctx(['orc.propostas:consultar']);
    expect(await digest(html({ proposta: '00000000-0000-4000-8000-0000000000ff' }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(await digest(html({}))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    contexto = ctx(['orc.totalizadores:consultar']);
    expect(await digest(html({ proposta: P1 }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(negacoes).toHaveLength(1);
  });
});
