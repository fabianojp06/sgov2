import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Dinheiro, Percentual } from '@/shared/kernel';
import { calcularPainel } from '../domain/resultado';
import { FormTeto } from './form-teto';
import { PainelTeto } from './painel-teto';

// Painel de teto, semáforo e resultado (US-059; plano do P6, Task 7).
const m12 = (v: string) => Array.from({ length: 12 }, () => Dinheiro.de(v));
const painel = (despesa: string, teto: Dinheiro | null, semaforo: 'LARANJA' | null = 'LARANJA', receitas = [{ situacao: 'CONFIRMADO' as const, meses: m12('100000') }]) => ({
  ...calcularPainel(m12(despesa), receitas, teto),
  semaforo,
  justificativaTeto: teto ? 'Convênio extra assinado' : null,
});
const html = (p: ReturnType<typeof painel>) => renderToString(createElement(PainelTeto, { painel: p }));

describe('PainelTeto', () => {
  it('receitas, despesas, resultado com superávit, teto padrão, % e semáforo com texto', () => {
    const h = html(painel('90000', null));
    expect(h).toContain('Receita prevista (fora do saldo e do teto)');
    expect(h).toContain('R$ 120.000,00 (superávit)');
    expect(h).toContain('(padrão: rateio líquido confirmado)');
    expect(h).toContain(Percentual.dePontos('90').formatar());
    expect(h).toContain('<dd>Laranja</dd>');
  });

  it('déficit e saldo negativo com o sinal e a classe de alerta; teto manual com a justificativa', () => {
    const h = html(painel('110000', Dinheiro.de('1000000')));
    expect(h).toMatch(/class="negativo">− R\$ 120\.000,00 \(déficit\)/);
    expect(h).toContain('(manual: Convênio extra assinado; padrão: R$ 1.200.000,00)');
    expect(h).toMatch(/class="negativo">− R\$ 320\.000,00 \(acima do teto\)/);
    expect(h).toContain('padrão: R$ 1.200.000,00');
  });

  it('sem receita confirmada nem teto: o texto de sem teto; sem semáforo: traço', () => {
    const h = html(painel('90000', null, null, []));
    expect(h).toContain('Sem teto: não há receita confirmada nem teto manual.');
    expect(h).toContain('<dd>—</dd>');
  });
});

describe('FormTeto', () => {
  it('valor no formato da tela, justificativa e os campos ocultos', () => {
    const h = renderToString(createElement(FormTeto, { exercicioId: 'e1', versao: 4, tetoManual: '1.000.000,00', justificativa: 'x', salvar: async () => ({ ok: true as const, valor: undefined }) }));
    expect(h).toContain('name="exercicioId" value="e1"');
    expect(h).toContain('name="versao" value="4"');
    expect(h).toContain('value="1.000.000,00"');
    expect(h).toContain('Teto manual (R$; vazio = padrão)');
  });
});
