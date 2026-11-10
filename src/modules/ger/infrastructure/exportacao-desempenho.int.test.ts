import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { LIMITE_EXPORTACAO_SINCRONA, type PlanilhaExportacao } from './exportacao';
import { exportarCsv } from './exportar-csv';
import { exportarXlsx } from './exportar-xlsx';

// Exportação síncrona no limite (§10.3, RF_IMP_003: até 5.000 linhas na hora; plano do P7, Task 3,
// Step 2; US-116, #138). A §10.3 não fixa tempo para a exportação: o teto de 5 s é uma trava de
// regressão escolhida no plano, não meta da spec, e o tempo vai para o log ([META_EXPORTACAO]). Fica no
// projeto de integração, que roda os arquivos em série: na unidade, em paralelo, o tempo oscilaria.
const TETO_MS = 5000;

const planilha: PlanilhaExportacao = {
  nome: 'Limite',
  colunas: [
    { titulo: 'Conta', tipo: 'texto' },
    { titulo: 'Descrição', tipo: 'texto' },
    { titulo: 'Centro de custo', tipo: 'texto' },
    { titulo: 'Competência', tipo: 'competencia' },
    { titulo: 'Valor', tipo: 'dinheiro' },
    { titulo: 'Realizado', tipo: 'dinheiro' },
    { titulo: '%', tipo: 'percentual' },
    { titulo: 'Data', tipo: 'data' },
  ],
  linhas: Array.from({ length: LIMITE_EXPORTACAO_SINCRONA }, (_, i) => [
    `4.1.1.1.${String(i % 999).padStart(3, '0')}`,
    `Descrição da linha ${i} com acentuação e um texto médio`,
    `4.1.${(i % 9) + 1}`,
    'Jan/27',
    `${(i * 37) % 100000}.${String(i % 100).padStart(2, '0')}`,
    `${(i * 13) % 100000}.50`,
    `${i % 100}.25`,
    '2027-03-05',
  ]),
};

async function medir(nome: string, fn: () => Promise<{ ok: boolean }> | { ok: boolean }): Promise<number> {
  const inicio = performance.now();
  const r = await fn();
  const ms = performance.now() - inicio;
  expect(r.ok, nome).toBe(true);
  console.log(`[META_EXPORTACAO] ${nome}: ${ms.toFixed(0)} ms para ${LIMITE_EXPORTACAO_SINCRONA} linhas`);
  return ms;
}

describe('exportação síncrona no limite de 5.000 linhas', () => {
  it('XLSX dentro do teto', async () => {
    expect(await medir('XLSX', () => exportarXlsx([planilha]))).toBeLessThanOrEqual(TETO_MS);
  }, 30_000);

  it('CSV dentro do teto', async () => {
    expect(await medir('CSV', () => exportarCsv(planilha))).toBeLessThanOrEqual(TETO_MS);
  });
});
