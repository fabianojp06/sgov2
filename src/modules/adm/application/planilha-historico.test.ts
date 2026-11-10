import { describe, expect, it } from 'vitest';
import { MENSAGEM_MUITOS_PENDENTES } from '@/modules/ger/servidor';
import { avisoDaRecusa, MENSAGEM_EXPORTACAO_LIMITE } from './historico';
import type { TxCliente } from '@/shared/db';
import {
  filtrosLegiveis,
  gerarExportacaoHistorico,
  GERADORES_EXPORTACAO_ADM,
  lerParametrosPedido,
  MENSAGEM_PEDIDO_INVALIDO,
  MENSAGEM_PERIODO,
  parametrosDoPedido,
} from './planilha-historico';

// Exportação assíncrona do Histórico (US-040, US-024): o pedido gravado é relido no worker com as
// regras da tela; chave a mais ou valor fora do formato recusa o pedido. Quem pediu não vai nos
// parâmetros: o gerador recebe o dono da linha do pedido (#377).
const U = '0b7f9c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e';
const DE = new Date('2026-10-01T03:00:00.000Z');
const ATE = new Date('2026-11-01T02:59:59.999Z');
const invalido = { ok: false, erros: [{ campo: '_', mensagem: MENSAGEM_PEDIDO_INVALIDO }] };

describe('parametrosDoPedido e lerParametrosPedido', () => {
  it('ida e volta: o período em ISO e só os filtros preenchidos, sem quem pediu', () => {
    const p = parametrosDoPedido({ de: DE, ate: ATE, usuario: 'ana', tipo: 'LOGIN' });
    expect(p).toEqual({ de: '2026-10-01T03:00:00.000Z', ate: '2026-11-01T02:59:59.999Z', usuario: 'ana', tipo: 'LOGIN' });
    // O pedido passa pelo JSON do banco.
    expect(lerParametrosPedido(JSON.parse(JSON.stringify(p)))).toEqual({ ok: true, valor: { de: DE, ate: ATE, usuario: 'ana', tipo: 'LOGIN' } });
    expect(lerParametrosPedido(parametrosDoPedido({ de: DE, ate: ATE, funcionalidade: 'orc.exercicios' }))).toMatchObject({ ok: true, valor: { funcionalidade: 'orc.exercicios' } });
  });

  it.each([
    ['nulo', null],
    ['lista', []],
    ['sem período', { usuario: 'ana' }],
    ['quem pediu nos parâmetros (o dono vem da linha do pedido)', { usuarioId: U, de: DE.toISOString(), ate: ATE.toISOString() }],
    ['data fora do ISO', { de: '2026-10-01', ate: ATE.toISOString() }],
    ['chave a mais', { de: DE.toISOString(), ate: ATE.toISOString(), antes: true }],
    ['tipo fora da lista', { de: DE.toISOString(), ate: ATE.toISOString(), tipo: 'APAGAR' }],
    ['funcionalidade fora do formato', { de: DE.toISOString(), ate: ATE.toISOString(), funcionalidade: "adm.x' OR 1=1" }],
    ['usuário acima de 120 caracteres', { de: DE.toISOString(), ate: ATE.toISOString(), usuario: 'x'.repeat(121) }],
    ['filtro vazio', { de: DE.toISOString(), ate: ATE.toISOString(), usuario: '' }],
  ])('recusa: %s', (_nome, p) => {
    expect(lerParametrosPedido(p)).toEqual(invalido);
  });

  it('período acima de 366 dias ou invertido: a mesma mensagem da tela', () => {
    const r = lerParametrosPedido({ de: ATE.toISOString(), ate: DE.toISOString() });
    expect(r).toEqual({ ok: false, erros: [{ campo: 'de', mensagem: MENSAGEM_PERIODO }] });
  });

  it('o gerador recusa o dono do pedido que não é UUID antes de ir ao banco', async () => {
    const tx = new Proxy({}, { get: () => { throw new Error('não deveria consultar o banco'); } }) as TxCliente;
    const parametros = parametrosDoPedido({ de: DE, ate: ATE });
    expect(await gerarExportacaoHistorico(tx, parametros, { usuarioId: 'x' })).toEqual(invalido);
  });
});

describe('cabeçalho, geradores e avisos', () => {
  it('filtros legíveis: o período em dias de Brasília e os filtros preenchidos', () => {
    expect(filtrosLegiveis({ de: DE, ate: ATE, usuario: 'ana', funcionalidade: 'adm.usuarios', tipo: 'LOGIN' })).toEqual([
      { rotulo: 'Período', valor: '2026-10-01 a 2026-10-31' },
      { rotulo: 'Usuário', valor: 'ana' },
      { rotulo: 'Funcionalidade', valor: 'adm.usuarios' },
      { rotulo: 'Tipo de Operação', valor: 'LOGIN' },
    ]);
  });

  it('o worker recebe um gerador só para o Histórico', () => {
    expect(Object.keys(GERADORES_EXPORTACAO_ADM)).toEqual(['adm.historico']);
  });

  it('cada recusa tem o seu aviso; outra recusa não diz que passou do teto', () => {
    expect(avisoDaRecusa([{ campo: '_', mensagem: MENSAGEM_MUITOS_PENDENTES }])).toBe('exportacao-pendentes');
    expect(avisoDaRecusa([{ campo: '_', mensagem: MENSAGEM_EXPORTACAO_LIMITE }])).toBe('exportacao-recusada');
    expect(avisoDaRecusa([{ campo: '_', mensagem: 'outra' }])).toBe('exportacao-falhou');
  });
});
