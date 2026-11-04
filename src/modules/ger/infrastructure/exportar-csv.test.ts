import { describe, expect, it } from 'vitest';
import { exportarCsvFalso } from '../falsos';
import type { PlanilhaExportacao } from './exportacao';
import { exportarCsv, textoSeguro } from './exportar-csv';

// Exportação CSV segura (issue #233): exportar e ler os bytes de volta.
function texto(r: ReturnType<typeof exportarCsv>): string {
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(r.valor);
}

// Leitor mínimo de CSV (RFC 4180, ";"), para conferir campo a campo sem confiar no gerador.
function campos(csv: string): string[][] {
  const linhas: string[][] = [];
  let linha: string[] = [];
  let atual = '';
  let aspas = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i]!;
    if (aspas) {
      if (c === '"' && csv[i + 1] === '"') {
        atual += '"';
        i++;
      } else if (c === '"') aspas = false;
      else atual += c;
    } else if (c === '"') aspas = true;
    else if (c === ';') {
      linha.push(atual);
      atual = '';
    } else if (c === '\r' && csv[i + 1] === '\n') {
      linha.push(atual);
      linhas.push(linha);
      linha = [];
      atual = '';
      i++;
    } else atual += c;
  }
  return linhas;
}

const INJECOES = [
  '=HYPERLINK("http://x","clique")',
  '+55 11 9999',
  '-2+3+cmd|\' /C calc\'!A0',
  '@soma',
  '\tx',
  '\rx',
  '  =1+1',
  '\u00A0=1+1',
  '\uFF1D1+1',
  '\uFF0B1',
  '\uFF0D1',
  '\uFF201',
  '\n=1+1',
  '\u3000=1+1',
  '\u2003=1+1',
  '\uFEFF=1+1',
  '\u200B=1+1',
];

const planilha: PlanilhaExportacao = {
  nome: 'Orçamento',
  colunas: [
    { titulo: 'Conta', tipo: 'texto' },
    { titulo: 'Valor', tipo: 'dinheiro' },
    { titulo: '%', tipo: 'percentual' },
    { titulo: 'Competência', tipo: 'competencia' },
    { titulo: 'Data', tipo: 'data' },
  ],
  linhas: [
    ['4.1.1.1.001 Salários; "extra"', '1234.50', '51', 'Jan/27', '2027-03-05'],
    ['Negativo', '-10.00', '0.5', 'Dez/27', null],
    ['Limites', '9999999999999.99', '100', 'Jan/27', '0099-12-31'],
    ['Casas', '0.01', '12.345', 'Jan/27', null],
    ['Inválido', 'abc', 'x', 'Xyz/99', '2027-02-30'],
    ['Linha\nquebrada', null, null, null, null],
  ],
};

describe('exportarCsv', () => {
  it('gera BOM UTF-8, ";", \\r\\n e todo campo entre aspas', () => {
    const r = exportarCsv(planilha);
    if (!r.ok) throw new Error('falhou');
    expect([...r.valor.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = texto(r);
    expect(csv.startsWith('\uFEFF"Conta";"Valor";"%";"Competência";"Data"\r\n')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('formata cada tipo para o Excel em pt-BR, pelo kernel', () => {
    const [cab, ...dados] = campos(texto(exportarCsv(planilha)).slice(1));
    expect(cab).toEqual(['Conta', 'Valor', '%', 'Competência', 'Data']);
    expect(dados).toEqual([
      ['4.1.1.1.001 Salários; "extra"', '1234,50', '51,00', 'Jan/27', '05/03/2027'],
      ['Negativo', '-10,00', '0,50', 'Dez/27', ''],
      ['Limites', '9999999999999,99', '100,00', 'Jan/27', '31/12/0099'],
      ['Casas', '0,01', '12,345', 'Jan/27', ''],
      ['Inválido', '—', '—', '—', '—'],
      ['Linha\nquebrada', '', '', '', ''],
    ]);
  });

  it('escapa com apóstrofo todo texto e título que vira fórmula, sem tocar no dinheiro negativo', () => {
    const p: PlanilhaExportacao = {
      nome: 'Injeção',
      colunas: [
        { titulo: '=titulo()', tipo: 'texto' },
        { titulo: 'Valor', tipo: 'dinheiro' },
      ],
      linhas: INJECOES.map((t) => [t, '-1.00']),
    };
    const [cab, ...dados] = campos(texto(exportarCsv(p)).slice(1));
    expect(cab![0]).toBe("'=titulo()");
    expect(dados.map((l) => l[0])).toEqual(INJECOES.map((t) => `'${t}`));
    expect(dados.every((l) => l[1] === '-1,00')).toBe(true);
  });

  it('não escapa texto comum, nem o que só contém os caracteres no meio', () => {
    for (const t of ['Salários', 'a=b', 'e-mail', 'x@y.org', '1+1', '']) expect(textoSeguro(t)).toBe(t);
  });

  it('tira o NUL e corta no limite do Excel', () => {
    expect(textoSeguro('a\0b\0')).toBe('ab');
    expect(textoSeguro('x'.repeat(40_000))).toHaveLength(32_767);
    expect(textoSeguro('='.repeat(40_000))).toHaveLength(32_767);
  });

  it('recusa pelas regras do C3 (linha sem um valor por coluna, acima do limite síncrono)', () => {
    const torta = exportarCsv({ ...planilha, linhas: [['só um']] });
    expect(!torta.ok && torta.erros.map((e) => e.campo)).toEqual(['planilhas.0.linhas']);
    const grande = exportarCsv({ ...planilha, linhas: Array.from({ length: 5001 }, () => ['a', null, null, null, null]) });
    expect(!grande.ok && grande.erros.map((e) => e.campo)).toEqual(['linhas']);
  });

  it('o falso registra a chamada e devolve ok', () => {
    const falso = exportarCsvFalso();
    expect(falso.exportar(planilha).ok).toBe(true);
    expect(falso.chamadas).toEqual([planilha]);
  });
});
