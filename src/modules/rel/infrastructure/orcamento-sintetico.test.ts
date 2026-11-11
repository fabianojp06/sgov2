import { describe, expect, it } from 'vitest';
import {
  CCS_ANALITICOS,
  COLUNAS_PACOTES,
  COLUNAS_PESSOAL,
  COLUNAS_RECEITAS,
  CONTAS_PACOTE,
  gerarOrcamentoSintetico,
  montarArquivo,
} from '../../../../ops/carga/orcamento-sintetico';

// Gerador do orçamento sintético da D-P7-3 (ops/carga, plano do P7, Task 3, Step 1): as regras que a
// frente A passou na #138 (10/11). Fica no projeto de unidade do rel, ao lado da conferência da carga,
// porque o vitest não varre ops/. A importação real dos arquivos entra quando o orc expuser o contrato
// pedido na #138.
const anos = [2027, 2028, 2029, 2030, 2031];
const MESES = COLUNAS_RECEITAS.slice(3);

describe('orçamento sintético da Adm. Central', () => {
  it('os 27 CCs analíticos da minuta e contas fora de pessoal, encargos e provisões', () => {
    expect(CCS_ANALITICOS).toHaveLength(27);
    expect(CONTAS_PACOTE.length).toBeGreaterThan(50);
    expect(CONTAS_PACOTE.filter((c) => /^4\.1\.1\.[128]\./.test(c))).toEqual([]);
    // O ramo 9 do plano sintético (inativado pela seed de referência) não entra.
    expect(CONTAS_PACOTE.filter((c) => c.startsWith('9'))).toEqual([]);
  });

  it.each(anos)('%i: volume perto de 1.000 linhas analíticas e campos dentro das regras da importação', (ano) => {
    const o = gerarOrcamentoSintetico(ano);
    expect(o.pessoal).toHaveLength(27 * 8);
    expect(o.pacotes).toHaveLength(27 * 25);
    for (const p of o.pessoal) {
      expect(CCS_ANALITICOS).toContain(p['CC analítico']);
      expect(String(p['Cargo']).length).toBeLessThanOrEqual(120);
      expect(p['Quantidade']).toBeGreaterThanOrEqual(1);
      expect(p['Salário mensal (R$)']).toBeGreaterThan(0);
      expect(p['Salário mensal (R$)']).toBeLessThan(1_000_000);
      expect(p['Mês de início (1–12)']).toBeGreaterThanOrEqual(1);
      expect(p['Mês de saída (1–12)']).toBeGreaterThanOrEqual(p['Mês de início (1–12)'] as number);
      expect(p['Mês de saída (1–12)']).toBeLessThanOrEqual(12);
    }
    for (const p of o.pacotes) {
      expect(CONTAS_PACOTE).toContain(p['Conta analítica']);
      expect(String(p['Atividade / justificativa (mín. 10 caracteres)']).length).toBeGreaterThanOrEqual(10);
      expect(['Essencial', 'Importante', 'Desejável']).toContain(p['Prioridade']);
      expect(p['Valor unitário (R$)']).toBeGreaterThan(0);
      expect(p['Valor unitário (R$)']).toBeLessThan(100_000_000);
      expect(p['Distribuição'] === 'Pontual').toBe(p['Mês (se pontual)'] !== undefined);
    }
    for (const r of o.receitas) for (const m of MESES) expect(r[m]).toBeLessThan(100_000_000_000);
    expect(new Set(o.receitas.map((r) => r['TP / versão'])).size).toBe(o.receitas.length);
    // Valores com no máximo 2 casas.
    const valores = [...o.pessoal.map((p) => p['Salário mensal (R$)']), ...o.pacotes.map((p) => p['Valor unitário (R$)'])] as number[];
    expect(valores.filter((v) => Math.round(v * 100) / 100 !== v)).toEqual([]);
  });

  it('nenhum texto começa com = + - @ (o leitor recusa fórmula disfarçada)', () => {
    const textos = anos.flatMap((a) => {
      const o = gerarOrcamentoSintetico(a);
      return [...o.pessoal, ...o.pacotes, ...o.receitas].flatMap((l) => Object.values(l).filter((v): v is string => typeof v === 'string'));
    });
    expect(textos.filter((t) => /^[=+\-@]/.test(t))).toEqual([]);
  });

  it('determinístico: o mesmo ano dá os mesmos dados; anos diferentes, dados diferentes', () => {
    expect(gerarOrcamentoSintetico(2028)).toEqual(gerarOrcamentoSintetico(2028));
    expect(gerarOrcamentoSintetico(2028).pacotes).not.toEqual(gerarOrcamentoSintetico(2029).pacotes);
  });

  it('o .xlsx fica muito abaixo de 1 MiB (limite do leitor) e tem as colunas na linha 4', async () => {
    const arquivo = await montarArquivo(gerarOrcamentoSintetico(2031));
    expect(arquivo.byteLength).toBeLessThan(1024 * 1024);
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(arquivo.buffer as ArrayBuffer);
    expect(wb.getWorksheet('Instruções')!.getCell('E1').value).toBe('ADMC-ORC v1.0');
    const cabecalho = (aba: string, n: number) => Array.from({ length: n }, (_, i) => wb.getWorksheet(aba)!.getCell(4, i + 1).value);
    expect(cabecalho('Pessoal', COLUNAS_PESSOAL.length)).toEqual([...COLUNAS_PESSOAL]);
    expect(cabecalho('Pacotes base zero', COLUNAS_PACOTES.length)).toEqual([...COLUNAS_PACOTES]);
    expect(cabecalho('Receitas', COLUNAS_RECEITAS.length)).toEqual([...COLUNAS_RECEITAS]);
  });

  it('ano fora da faixa: erro', () => {
    expect(() => gerarOrcamentoSintetico(2026)).toThrow();
  });
});
