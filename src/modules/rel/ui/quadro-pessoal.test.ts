import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Dinheiro } from '@/shared/kernel';
import { agregarQuadro, type EmpregadoEntrada } from '../domain/quadro-pessoal';
import { avisoDaAnalise, ConteudoAnalise, estadoDaAnalise, TEXTOS_ANALISE, type EstadoQuadro } from './quadro-pessoal';
import { agregarAdmCentral } from '../domain/quadro-adm-central';
import { TabelaAdmCentral, TabelaQuadro, TEXTOS_QUADRO } from './quadro-pessoal-tabela';

const html = (estado: EstadoQuadro) => renderToStaticMarkup(createElement(ConteudoAnalise, { estado }));
const emp = (nome: string | null, custo: string): EmpregadoEntrada => ({ categoria: 'EMPREGADO', avisos: [], nome, cargo: 'C001 – Analista', inicio: '2027-01', fim: '2027-12', custoPeriodo: Dinheiro.de(custo) });
const quadro = agregarQuadro([
  {
    numero: 'TP-07',
    tipo: 'TERMO_PARCERIA',
    situacao: 'EM_ELABORACAO',
    vigencia: { inicio: '2027-01', fim: '2027-12' },
    veCusto: true,
    grupos: [{ empregados: [emp('Nome Secreto', '1000.00'), emp(null, '1000.00'), emp('Outro Nome', '1500.00')] }],
  },
  { numero: 'TP-08', tipo: 'CONTRATO', situacao: 'RASCUNHO', vigencia: { inicio: '2027-01', fim: '2027-12' }, veCusto: false, grupos: [{ empregados: [emp('X', '1.00')] }] },
]);

describe('tela da análise do quadro de pessoal (US-107)', () => {
  it('análise com o selo antes do resumo, destaques, alertas e os agregados enviados', () => {
    const h = html({ tipo: 'PRONTA', analise: { resumo: 'Quadro enxuto.', destaques: ['Um destaque.'], alertas: ['Uma vaga aberta.'] }, quadro, admCentral: null });
    expect(h.indexOf(TEXTOS_ANALISE.SELO)).toBeGreaterThan(-1);
    expect(h.indexOf(TEXTOS_ANALISE.SELO)).toBeLessThan(h.indexOf('Quadro enxuto.'));
    expect(h).toContain('Um destaque.');
    expect(h).toContain('Uma vaga aberta.');
    expect(h).toContain(TEXTOS_ANALISE.ENVIADO);
    expect(h).toContain('TP-07');
  });

  it('sem destaques nem alertas, as seções somem; a região viva só tem o aviso curto; ids da tabela enviada com outro prefixo', () => {
    const pronta: EstadoQuadro = { tipo: 'PRONTA', analise: { resumo: 'R.', destaques: [], alertas: [] }, quadro, admCentral: null };
    const h = html(pronta);
    expect(h).not.toContain(TEXTOS_ANALISE.DESTAQUES);
    expect(h).not.toContain(TEXTOS_ANALISE.ALERTAS);
    expect(h).toContain('id="enviado-TP-07"');
    expect(h).not.toContain('id="quadro-TP-07"');
    expect(avisoDaAnalise(pronta)).toBe(TEXTOS_ANALISE.PRONTA);
    expect(avisoDaAnalise({ tipo: 'CONSULTANDO' })).toBe(TEXTOS_ANALISE.CONSULTANDO);
    expect(avisoDaAnalise({ tipo: 'ERRO', mensagem: 'x' })).toBe('');
    expect(html({ tipo: 'CONSULTANDO' })).toBe('');
    expect(html({ tipo: 'OCIOSO' })).toBe('');
    expect(estadoDaAnalise({ ok: false, erros: [{ campo: '_', mensagem: 'A.' }, { campo: '_', mensagem: 'B.' }] })).toEqual({ tipo: 'ERRO', mensagem: 'A. B.' });
  });

  it('a tabela mostra os agregados, nunca os nomes; o custo omitido diz o motivo', () => {
    const h = renderToStaticMarkup(createElement(TabelaQuadro, { quadro }));
    expect(h).not.toContain('Nome Secreto');
    expect(h).not.toContain('Outro Nome');
    expect(h).toContain('TP-07 – Termo de Parceria (Em Elaboração), vigência 01/2027 a 12/2027');
    expect(h).toContain(TEXTOS_QUADRO.SEM_CUSTO.SEM_PERMISSAO);
    expect(h).toContain('3.500,00');
    expect(h).toContain('id="quadro-TP-07"');
    expect(h).toContain(`${TEXTOS_QUADRO.A_CONTRATAR}: 1`);
  });

  it('Adm. Central: um quadro por exercício, com a diretoria, os postos e o motivo do custo omitido; na análise, com outro prefixo', () => {
    const adm = agregarAdmCentral(
      [{ ano: 2028, situacao: 'Em elaboração', veSalario: true, posicoes: [{ cc: '4.4', quantidade: 1, mesInicio: 1, mesSaida: 12, valorAnual: Dinheiro.de('1.00') }] }],
      () => 'Suporte Administrativo',
    );
    const h = renderToStaticMarkup(createElement(TabelaAdmCentral, { quadro: adm }));
    expect(h).toContain('Exercício 2028 (Em elaboração)');
    expect(h).toContain('4.4 – Suporte Administrativo');
    expect(h).toContain(TEXTOS_QUADRO.SEM_CUSTO.POUCOS_POSTOS);
    expect(h).toContain('id="adm-2028"');
    const a = html({ tipo: 'PRONTA', analise: { resumo: 'R.', destaques: [], alertas: [] }, quadro: null, admCentral: adm });
    expect(a).toContain('id="enviado-adm-2028"');
    expect(a).not.toContain('enviado-TP');
  });
});
