import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { Dinheiro, Percentual } from '@/shared/kernel';
import type { RateioTela } from '../application/rateio';
import { MENSAGENS_ORC as M } from '../domain/mensagens';

// Página de Rateio/ISS da proposta (US-073; plano do P24, Task 2, Step 1).
vi.mock('next/server', () => ({ connection: async () => undefined }));
const P1 = '00000000-0000-4000-8000-0000000000b1';
const caso = vi.hoisted(() => ({ semGrade: false, restrita: false, contrato: false, imutavel: false }));

const dados = (): RateioTela => ({
  propostaId: P1,
  numero: 'TP-2027/001',
  objeto: 'Programa de capacitação',
  tipo: caso.contrato ? 'CONTRATO' : 'TERMO_PARCERIA',
  versaoNumero: 2,
  situacao: caso.imutavel ? 'EM_APROVACAO' : 'RASCUNHO',
  editavel: !caso.imutavel,
  versaoCapa: 7,
  competencias: ['2027-01', '2027-02'],
  grade: caso.semGrade
    ? null
    : {
        contaSintetica: '4.1.1',
        descricaoSintetica: 'SERVIÇOS',
        modo: 'PERCENTUAL',
        aliquotaIss: caso.contrato ? Percentual.dePontos('3.5') : null,
        linhas: [
          {
            conta: '4.3.1.1.001',
            descricao: 'Taxa de Administração Central',
            celulas: { '2027-01': { valor: Dinheiro.de('2450.00'), percentual: Percentual.dePontos('10') } },
            total: Dinheiro.de('2450.00'),
          },
        ],
        total: Dinheiro.de('2450.00'),
      },
  base: caso.restrita || caso.semGrade ? null : Dinheiro.de('24500.00'),
  baseRestrita: caso.restrita,
  opcoes: { sinteticas: [{ classificacao: '4.1.1', descricao: 'SERVIÇOS' }], analiticas: [{ classificacao: '4.3.1.1.001', descricao: 'Taxa de Administração Central' }] },
});

vi.mock('@/modules/orc', async (original) => {
  const { exigir } = await import('@/shared/authz');
  return {
    ...(await original<typeof import('@/modules/orc')>()),
    obterRateio: async (ctx: ContextoRequisicao, id: string) => {
      exigir(ctx, 'orc.rateio', 'consultar');
      return id === P1 ? dados() : null;
    },
    propostasParaRateio: async (ctx: ContextoRequisicao) => {
      exigir(ctx, 'orc.rateio', 'consultar');
      return [{ id: P1, numero: 'TP-2027/001', objeto: 'Programa de capacitação', tipo: 'Termo de Parceria' }];
    },
  };
});

const { default: Rateio } = await import('../../../app/(sistema)/orc/rateio/page');

const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: 'u1', usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
const LANCA = ['consultar', 'incluir', 'alterar', 'excluir'].map((a) => `orc.rateio:${a}`);
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];

beforeEach(() => {
  Object.assign(caso, { semGrade: false, restrita: false, contrato: false, imutavel: false });
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
const html = async (busca: Record<string, string> = {}) => renderToStaticMarkup(await Rateio({ searchParams: Promise.resolve(busca) }));

describe('página de Rateio/ISS', () => {
  it('quem lança: resumo com a base e o saldo, a grade em leitura com o Replicar, o formulário com o % e a exclusão', async () => {
    contexto = ctx(LANCA);
    const h = await html({ proposta: P1, aviso: 'salvo' });
    expect(h).toContain(`<p role="status">${M.RATEIO_SALVO('TP-2027/001')}</p>`);
    expect(h).toContain('<dt>Base (orçado da conta mandante)</dt><dd>R$ 24.500,00</dd>');
    expect(h).toContain('<dt>Saldo da base</dt><dd>R$ 22.050,00</dd>');
    expect(h).toContain('<dd>Termo de Parceria: imune.</dd>');
    expect(h).toContain('<th scope="row">4.3.1.1.001 – Taxa de Administração Central</th><td>2.450,00</td><td>0,00</td><td>2.450,00</td>');
    expect(h).toContain('Replicar o primeiro mês da conta 4.3.1.1.001');
    expect(h).toContain('Excluir a grade de rateio da proposta TP-2027/001');
    expect(h).toContain('<input type="hidden" name="modoAnterior" value="PERCENTUAL"/>');
    expect(h).toContain('name="c_0_2027-01"');
    expect(h).toMatch(/name="c_0_2027-01"[^>]*value="10"/);
    expect(h).toContain('name="conta_2"');
    expect(h).not.toContain('name="conta_3"');
    expect(h).not.toContain('name="aliquotaIss"');
  });

  it('Contrato: a alíquota no formulário e o ISS a definir; base restrita sem o saldo', async () => {
    contexto = ctx(LANCA);
    caso.contrato = true;
    caso.restrita = true;
    const h = await html({ proposta: P1 });
    expect(h).toContain('name="aliquotaIss"');
    expect(h).toMatch(/name="aliquotaIss"[^>]*value="3,5"/);
    expect(h).toContain(M.RATEIO_ISS_A_DEFINIR);
    expect(h).toContain(M.RATEIO_BASE_RESTRITA);
    expect(h).not.toContain('Saldo da base');
  });

  it('quem só consulta e a versão imutável: sem formulário nem ações; sem grade: o texto', async () => {
    contexto = ctx(['orc.rateio:consultar']);
    const h = await html({ proposta: P1 });
    expect(h).not.toContain('<form');
    expect(h).not.toContain('Replicar');
    contexto = ctx(LANCA);
    caso.imutavel = true;
    expect(await html({ proposta: P1 })).not.toContain('Salvar grade');
    caso.imutavel = false;
    caso.semGrade = true;
    const n = await html({ proposta: P1 });
    expect(n).toContain('Esta versão ainda não tem grade de rateio.');
    expect(n).toContain('Nova grade de rateio');
  });

  it('sem proposta: a lista; sem permissão: 404', async () => {
    contexto = ctx(['orc.rateio:consultar']);
    expect(await html()).toContain(`<a href="/orc/rateio?proposta=${P1}">Rateio/ISS da proposta TP-2027/001 – Programa de capacitação</a>`);
    contexto = ctx(['orc.propostas:consultar']);
    expect(await digest(html())).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(negacoes).toHaveLength(1);
  });
});
