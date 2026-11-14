import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { Dinheiro } from '@/shared/kernel';
import type { TotalizadoresTela } from '../application/totalizadores';
import { MENSAGENS_ORC as M } from '../domain/mensagens';
import { montarArvore } from '../domain/totalizador';

// Página dos totalizadores da proposta (US-074; plano do P23, Task 2, Step 1).
vi.mock('next/server', () => ({ connection: async () => undefined }));
const P1 = '00000000-0000-4000-8000-0000000000b1';
const caso = vi.hoisted(() => ({ semPessoal: false, vazio: false }));

const plano = [
  {
    classificacao: '4',
    descricao: 'DESPESAS',
    nivel: 1,
    tipo: 'SINTETICA' as const,
    filhos: [
      {
        classificacao: '4.1',
        descricao: 'OPERACIONAIS',
        nivel: 2,
        tipo: 'SINTETICA' as const,
        filhos: [{ classificacao: '4.1.1.5.005', descricao: 'Material', nivel: 5, tipo: 'ANALITICA' as const, filhos: [] }],
      },
    ],
  },
];
const dados = (): TotalizadoresTela => ({
  propostaId: P1,
  numero: 'TP-2027/001',
  objeto: 'Programa de capacitação',
  tipo: 'TERMO_PARCERIA',
  versaoNumero: 2,
  situacao: 'RASCUNHO',
  arvore: caso.vazio ? [] : montarArvore(plano, () => Dinheiro.de('5600.00')),
  foraDoPlano: caso.vazio ? [] : [{ conta: '9.9.9.9.999', valor: Dinheiro.de('10.00') }],
  total: caso.vazio ? Dinheiro.zero() : Dinheiro.de('5610.00'),
  avisos: caso.vazio ? [] : ['O exercício 2028 não tem parâmetros: o custo desse ano ficou de fora.'],
  semPessoal: caso.semPessoal,
});

vi.mock('@/modules/orc', async (original) => {
  const { exigir } = await import('@/shared/authz');
  return {
    ...(await original<typeof import('@/modules/orc')>()),
    obterTotalizadores: async (ctx: ContextoRequisicao, id: string) => {
      exigir(ctx, 'orc.totalizadores', 'consultar');
      return id === P1 ? dados() : null;
    },
    propostasParaTotalizar: async (ctx: ContextoRequisicao) => {
      exigir(ctx, 'orc.totalizadores', 'consultar');
      return [{ id: P1, numero: 'TP-2027/001', objeto: 'Programa de capacitação', tipo: 'Termo de Parceria' }];
    },
  };
});

const { default: Totalizadores } = await import('../../../app/(sistema)/orc/totalizadores/page');

const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: 'u1', usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];

beforeEach(() => {
  caso.semPessoal = false;
  caso.vazio = false;
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
const html = async (busca: Record<string, string> = {}) => renderToStaticMarkup(await Totalizadores({ searchParams: Promise.resolve(busca) }));

describe('página dos totalizadores', () => {
  it('a árvore só leitura, com orçado, realizado, saldo e semáforo; fora do plano; total; sem botão (RN_TOT_01)', async () => {
    contexto = ctx(['orc.totalizadores:consultar']);
    const h = await html({ proposta: P1 });
    expect(h).toContain('<details open=""><summary><strong>4 – DESPESAS</strong>');
    expect(h).toContain('<strong>4.1.1.5.005 – Material</strong><span> Orçado 5.600,00 · Realizado 0,00 · Saldo 5.600,00 · ');
    expect(h).toContain('Semáforo Verde');
    expect(h).toContain(M.TOTALIZADOR_FORA_DO_PLANO);
    expect(h).toContain('9.9.9.9.999: Orçado 10,00');
    expect(h).toContain('<strong>Total geral (Valor Global):</strong> R$ 5.610,00');
    expect(h).toContain('O exercício 2028 não tem parâmetros');
    expect(h).not.toContain('<button');
    expect(h).not.toContain('<input');
  });

  it('sem o pessoal: o aviso; vazia: a mensagem do E1', async () => {
    contexto = ctx(['orc.totalizadores:consultar']);
    caso.semPessoal = true;
    expect(await html({ proposta: P1 })).toContain(M.TOTALIZADOR_SEM_PESSOAL);
    caso.semPessoal = false;
    caso.vazio = true;
    expect(await html({ proposta: P1 })).toContain(M.TOTALIZADOR_SEM_DESPESA);
  });

  it('sem proposta: a lista para escolher; proposta desconhecida: aviso e lista; sem permissão: 404', async () => {
    contexto = ctx(['orc.totalizadores:consultar']);
    expect(await html()).toContain(`<a href="/orc/totalizadores?proposta=${P1}">Totalizadores da proposta TP-2027/001 – Programa de capacitação</a>`);
    const x = await html({ proposta: '00000000-0000-4000-8000-000000000999' });
    expect(x).toContain('Proposta não encontrada nos seus Termos de Parceria.');
    expect(x).toContain('Escolha a proposta');
    contexto = ctx(['orc.propostas:consultar']);
    expect(await digest(html())).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(negacoes).toHaveLength(1);
  });
});
