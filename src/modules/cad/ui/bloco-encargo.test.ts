import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CustoCargoTela } from '../domain/cargo-tela';
import { BlocoEncargo } from './bloco-encargo';

// Bloco do custo do cargo (plano do P4, Task 14, Step 1; REQ_CAR_013 e R24).
const html = (custo: CustoCargoTela) => renderToString(createElement(BlocoEncargo, { custo, ano: 2027 }));
const completo: CustoCargoTela = {
  mascarado: false,
  base: '6500.00',
  encargoTotal: '3315.00',
  percentualTotal: '51,00%',
  componentes: [
    { nome: 'INSS', percentual: '38,00%', valor: '2470.00' },
    { nome: 'FGTS', percentual: '8,00%', valor: '520.00' },
  ],
  totalMes1: '9999.99',
  totalAno: '119999.88',
  linhasMes1: [
    { componente: 'salario', nome: null, valor: '5000.00' },
    { componente: 'adicional', nome: null, valor: '1500.00' },
    { componente: 'encargo.inss', nome: 'INSS', valor: '2950.12' },
    { componente: 'beneficio.vr', nome: 'Vale-refeição', valor: '800.00' },
  ],
  avisos: ['O benefício Seguro de vida é padrão da posição, mas está sem valor na Tabela Mestre de 2027.'],
};

describe('BlocoEncargo', () => {
  it('REQ_CAR_013: o consolidado (R$ e %) e o detalhe por componente, ao mesmo tempo', () => {
    const h = html(completo);
    expect(h).toContain('3.315,00');
    expect(h).toContain('51,00%');
    expect(h).toContain('6.500,00');
    expect(h).toMatch(/INSS.*38,00%.*2\.470,00/s);
    expect(h).toMatch(/FGTS.*8,00%.*520,00/s);
    expect(h).toMatch(/Salário.*5\.000,00/s);
    expect(h).toMatch(/Adicional.*1\.500,00/s);
    expect(h).toMatch(/Encargo: INSS.*2\.950,12/s);
    expect(h).toMatch(/Benefício: Vale-refeição.*800,00/s);
    expect(h).toContain('119.999,88');
    // Os dois encargos com rótulos distintos: o do cargo (UC03.19 §6.1) e o da série (C33).
    expect(h).toContain('Encargo social do cargo');
    expect(h).toContain('com férias e 13º provisionados');
    expect(h).toContain('Seguro de vida é padrão da posição, mas está sem valor');
  });

  it('ORCAMENTISTA: só o aviso, sem nenhum valor (R24)', () => {
    const h = html({ mascarado: true });
    expect(h).toContain('mascarado');
    expect(h).not.toMatch(/\d/);
  });

  it('com erro: a mensagem num role="status"', () => {
    expect(html({ mascarado: false, erro: 'Selecione a Fonte Ativa para calcular o custo.' })).toMatch(/role="status".*Selecione a Fonte Ativa/);
  });
});
