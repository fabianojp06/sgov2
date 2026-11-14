import { describe, expect, it, vi } from 'vitest';
import type { ContextoRequisicao } from '@/shared/authz';
import type { Classificacao } from '../domain/pergunte-sgo';
import type { TelaDespesas } from './despesas-tp';
import { executarConsulta, MENSAGENS_PERGUNTE, periodoDoTp } from './pergunte-sgo';
import type { TelaReceitasDespesas } from './receitas-despesas';

vi.mock('server-only', () => ({}));

// Pergunte ao SGO (US-104), parte 2: o realizado e o saldo de um TP pelos casos de uso dos demonstrativos
// (US-096), os mesmos das telas do link. Os demonstrativos são falsos aqui, no formato das telas.
const perm = (f: string, a = 'consultar') => [f, a].join(':');
const TODAS = [perm('orc.realizado'), perm('rel.despesas_tp'), perm('rel.receitas_despesas_tp')];
const ctx = (permissoes = TODAS): ContextoRequisicao => ({ usuarioId: 'u', usuarioRotulo: 'direx', sessaoUid: 's', ip: null, unidadeId: null, permissoes: new Set(permissoes) });
const TP = { numero: 'TP-3', objeto: 'Apoio', inicio: '2026-09', fim: '2028-06', versaoOficial: 2 };
const filtrosVazios = { tp: '', de: '', ate: '', exibirZerados: false };
const pedidos: unknown[] = [];
const lerDespesas = async (_c: ContextoRequisicao, f: { tp?: string; de?: string; ate?: string }): Promise<TelaDespesas> => {
  pedidos.push(f);
  if (!f.tp) return { tps: [TP], filtros: filtrosVazios, relatorio: null, erro: null };
  return {
    tps: [TP],
    filtros: { tp: f.tp, de: f.de!, ate: f.ate!, exibirZerados: false },
    relatorio: { tp: TP, totalGeral: { valores: [], total: '1234.50' }, atualizadoEm: new Date('2027-02-03T15:00:00Z') } as unknown as TelaDespesas['relatorio'],
    erro: null,
  };
};
let versaoPrevisto: number | null = 2;
const lerReceitasDespesas = async (_c: ContextoRequisicao, f: { tp?: string; de?: string; ate?: string }): Promise<TelaReceitasDespesas> => {
  pedidos.push(f);
  if (!f.tp) return { tps: [TP], filtros: filtrosVazios, relatorio: null, erro: null };
  return {
    tps: [TP],
    filtros: { tp: f.tp, de: f.de!, ate: f.ate!, exibirZerados: false },
    relatorio: { tp: TP, versaoPrevisto, totalGeral: { valores: [], total: { previsto: '5000.00', realizado: '1234.50', saldo: '3765.50' } } } as unknown as TelaReceitasDespesas['relatorio'],
    erro: null,
  };
};
const deps = { lerVisao: async () => null, lerConsolidado: async () => [], lerDespesas, lerReceitasDespesas };
const c = (consulta: Classificacao['consulta'], tp: string | null = 'tp 03', ano: number | null = null): Classificacao => ({ consulta, ano, cc: null, tp });

describe('Pergunte ao SGO, parte 2: realizado e saldo do TP', () => {
  it('período: o ano dito cortado na vigência, ou a vigência inteira; ano fora, nulo', () => {
    expect(periodoDoTp(TP, null)).toEqual({ de: '2026-09', ate: '2028-06' });
    expect(periodoDoTp(TP, 2026)).toEqual({ de: '2026-09', ate: '2026-12' });
    expect(periodoDoTp(TP, 2028)).toEqual({ de: '2028-01', ate: '2028-06' });
    expect(periodoDoTp(TP, 2030)).toBeNull();
  });

  it('realizado: o total geral da tela do demonstrativo, com o link para ela no mesmo período', async () => {
    const r = await executarConsulta(ctx(), c('REALIZADO_TP', 'tp 03', 2027), deps);
    expect(pedidos.at(-1)).toEqual({ tp: 'TP-3', de: '2027-01', ate: '2027-12' });
    expect(r).toMatchObject({ tipo: 'NUMERO', valor: '1234.50', link: '/rel/despesas-tp?tp=TP-3&de=2027-01&ate=2027-12' });
    expect(r.texto).toContain('em 2027');
    expect((r as { fonte: string }).fonte).toContain('atualizado em 03/02/2027');
  });

  it('saldo: previsto − realizado do demonstrativo de receitas e despesas; sem versão oficializada, sem dado', async () => {
    const r = await executarConsulta(ctx(), c('SALDO_TP'), deps);
    expect(r).toMatchObject({ tipo: 'NUMERO', valor: '3765.50', link: '/rel/receitas-despesas-tp?tp=TP-3&de=2026-09&ate=2028-06' });
    expect(r.texto).toContain('de Setembro/2026 a Junho/2028');
    versaoPrevisto = null;
    expect(await executarConsulta(ctx(), c('SALDO_TP'), deps)).toMatchObject({ tipo: 'SEM_DADO', texto: MENSAGENS_PERGUNTE.SEM_PREVISTO('TP-3') });
    versaoPrevisto = 2;
  });

  it('permissões: sem a do orc ou sem a do relatório do link, sem dado (e nada é lido); TP fora e ano fora', async () => {
    const antes = pedidos.length;
    expect(await executarConsulta(ctx([perm('rel.despesas_tp')]), c('REALIZADO_TP'), deps)).toMatchObject({ tipo: 'SEM_DADO', texto: MENSAGENS_PERGUNTE.SEM_ACESSO_REALIZADO });
    expect(await executarConsulta(ctx([perm('orc.realizado'), perm('rel.despesas_tp')]), c('SALDO_TP'), deps)).toMatchObject({ texto: MENSAGENS_PERGUNTE.SEM_ACESSO_REALIZADO });
    expect(pedidos.length).toBe(antes);
    expect(await executarConsulta(ctx(), c('REALIZADO_TP', 'TP-9'), deps)).toMatchObject({ texto: MENSAGENS_PERGUNTE.TP_SEM_REALIZADO('TP-9') });
    expect(await executarConsulta(ctx(), c('REALIZADO_TP', 'TP-3', 2031), deps)).toMatchObject({ texto: MENSAGENS_PERGUNTE.ANO_FORA_DA_VIGENCIA('TP-3', 2031) });
  });
});
