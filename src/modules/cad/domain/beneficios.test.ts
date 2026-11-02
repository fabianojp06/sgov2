import { describe, expect, it } from 'vitest';
import { Dinheiro } from '@/shared/kernel';
import { validarBeneficio, valorMensalPorPessoa, type EntradaBeneficio } from './beneficios';

// Tabela Mestre (plano do P4, Task 10, Step 1).
const valida = (c: string) => c === '4.1.1.1.009' || c === '4.1.1.1.008';
const vr: EntradaBeneficio = {
  codigo: 'beneficio.vr',
  nome: 'Vale-refeição',
  forma: 'VALOR_DIARIO',
  valor: '36,50',
  percentual: null,
  conta: '4.1.1.1.009',
  padraoPosicao: true,
  ativo: true,
};
const campos = (e: Partial<EntradaBeneficio>) => {
  const r = validarBeneficio({ ...vr, ...e }, valida);
  return r.ok ? [] : r.erros.map((x) => x.campo);
};

describe('valorMensalPorPessoa', () => {
  it('VR diário de 36,50 × 22 → 803,00; mensal 600,00 → 600,00; percentual → null; sem valor → null', () => {
    expect(valorMensalPorPessoa({ forma: 'VALOR_DIARIO', valor: Dinheiro.de('36.50') }, 22)?.paraString()).toBe('803.00');
    expect(valorMensalPorPessoa({ forma: 'VALOR_MENSAL', valor: Dinheiro.de('600.00') }, 22)?.paraString()).toBe('600.00');
    expect(valorMensalPorPessoa({ forma: 'PERCENTUAL_SALARIO', valor: null }, 22)).toBeNull();
    expect(valorMensalPorPessoa({ forma: 'VALOR_MENSAL', valor: null }, 22)).toBeNull();
  });
});

describe('validarBeneficio', () => {
  it('a entrada do VR é válida (vírgula decimal)', () => {
    const r = validarBeneficio(vr, valida);
    expect(r.ok && r.valor.valor?.paraString()).toBe('36.50');
  });

  it.each([
    ['percentual ausente', { forma: 'PERCENTUAL_SALARIO', valor: null, percentual: null }, 'percentual'],
    ['percentual acima de 100', { forma: 'PERCENTUAL_SALARIO', valor: null, percentual: '100.01' }, 'percentual'],
    ['valor no percentual', { forma: 'PERCENTUAL_SALARIO', valor: '10', percentual: '2' }, 'valor'],
    ['valor negativo', { valor: '-1' }, 'valor'],
    ['valor com 3 casas', { valor: '1.234' }, 'valor'],
    ['conta que não é analítica ativa', { conta: '4.1.1.1' }, 'conta'],
    ['código fora do formato', { codigo: 'vr' }, 'codigo'],
    ['código com maiúscula', { codigo: 'beneficio.VR' }, 'codigo'],
    ['nome vazio', { nome: '  ' }, 'nome'],
  ] as const)('%s → erro', (_caso, e, campo) => {
    expect(campos(e as Partial<EntradaBeneficio>)).toContain(campo);
  });

  it('percentual válido (R14a) e valor vazio aceito (item ainda sem valor)', () => {
    const p = validarBeneficio({ ...vr, forma: 'PERCENTUAL_SALARIO', valor: null, percentual: '2' }, valida);
    expect(p.ok && p.valor.percentual?.paraString()).toBe('2.0000');
    const semValor = validarBeneficio({ ...vr, valor: '' }, valida);
    expect(semValor.ok && semValor.valor.valor).toBeNull();
  });
});
