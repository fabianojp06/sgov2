import { describe, expect, it } from 'vitest';
import { validarParametros, validarSalarioMinimo, type EntradaParametros } from './parametros';

// Validação dos parâmetros por exercício (plano do P4, Task 9a, Step 1).
const CONTAS_VALIDAS = new Set(['4.1.1.1.001', '4.1.1.1.025', '4.1.1.1.003', '4.1.1.1.005', '4.1.1.2.001', '4.1.1.2.005', '4.1.1.2.008', '4.1.1.8.003', '4.1.1.8.004']);
const valida = (c: string) => CONTAS_VALIDAS.has(c);

const entrada: EntradaParametros = {
  reajuste: '5',
  mesDataBase: 5,
  ipca: '4',
  diasUteisMes: 22,
  semaforo: { verdeAte: '70', amareloAte: '85', laranjaAte: '95' },
  encargos: [
    { componente: 'encargo.inss', percentual: '38', conta: '4.1.1.2.001' },
    { componente: 'encargo.fgts', percentual: '8', conta: '4.1.1.2.005' },
    { componente: 'encargo.pis', percentual: '1', conta: '4.1.1.2.008' },
    { componente: 'encargo.obrigacoes', percentual: '3,8', conta: '4.1.1.8.003' },
    { componente: 'encargo.riscos', percentual: '0.2', conta: '4.1.1.8.004' },
  ],
  contas: { salario: '4.1.1.1.001', adicional: '4.1.1.1.025', ferias: '4.1.1.1.003', decimo_terceiro: '4.1.1.1.005' },
};

const campos = (e: Partial<EntradaParametros>) => {
  const r = validarParametros({ ...entrada, ...e }, valida);
  return r.ok ? [] : r.erros.map((x) => x.campo);
};

describe('validarParametros', () => {
  it('a entrada padrão é válida; vírgula decimal aceita', () => {
    const r = validarParametros(entrada, valida);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor.encargos[3]!.percentual.paraString()).toBe('3.8000');
  });

  it.each([
    ['mês 13', { mesDataBase: 13 }, 'mesDataBase'],
    ['reajuste acima de 100', { reajuste: '100.01' }, 'reajuste'],
    ['reajuste negativo', { reajuste: '-1' }, 'reajuste'],
    ['casas demais', { reajuste: '5.12345' }, 'reajuste'],
    ['texto no lugar de número', { ipca: 'abc' }, 'ipca'],
    ['dias úteis 0', { diasUteisMes: 0 }, 'diasUteisMes'],
    ['faixas fora de ordem', { semaforo: { verdeAte: '85', amareloAte: '70', laranjaAte: '95' } }, 'semaforo'],
    ['faixas iguais', { semaforo: { verdeAte: '70', amareloAte: '70', laranjaAte: '95' } }, 'semaforo'],
    ['IPCA abaixo de -100', { ipca: '-100.01' }, 'ipca'],
    ['semáforo acima de 999', { semaforo: { verdeAte: '70', amareloAte: '85', laranjaAte: '999.01' } }, 'semaforo.laranjaAte'],
  ] as const)('%s → erro', (_caso, e, campo) => {
    expect(campos(e as Partial<EntradaParametros>)).toContain(campo);
  });

  it('encargo negativo, soma acima de 100, faltando ou repetido → erro', () => {
    const enc = entrada.encargos;
    expect(campos({ encargos: [{ ...enc[0]!, percentual: '-1' }, ...enc.slice(1)] })).toContain('encargos.0.percentual');
    expect(campos({ encargos: [{ ...enc[0]!, percentual: '90' }, ...enc.slice(1)] })).toContain('encargos');
    expect(campos({ encargos: enc.slice(1) })).toContain('encargos');
    expect(campos({ encargos: [...enc, enc[0]!] })).toContain('encargos.5.componente');
    // Soma exatamente 100 é aceita (o limite é "não passar de 100").
    expect(campos({ encargos: [{ ...enc[0]!, percentual: '87' }, ...enc.slice(1)] })).toEqual([]);
  });

  it('conta que não é analítica ativa (índice do C1) → erro no encargo e no componente', () => {
    expect(campos({ encargos: [{ ...entrada.encargos[0]!, conta: '4.1.1.2' }, ...entrada.encargos.slice(1)] })).toEqual(['encargos.0.conta']);
    expect(campos({ contas: { ...entrada.contas, ferias: '4.1.1.1' } })).toEqual(['contas.ferias']);
  });
});

describe('validarSalarioMinimo', () => {
  it('válido com 2 casas', () => {
    const r = validarSalarioMinimo('1518,00');
    expect(r.ok && r.valor.paraString()).toBe('1518.00');
  });

  it('999999,99 é o maior aceito', () => {
    expect(validarSalarioMinimo('999999,99').ok).toBe(true);
  });

  it.each(['0', '0.00', '-1', '1518.001', 'mil', '1000000.00'])('%s → erro', (v) => {
    expect(validarSalarioMinimo(v).ok).toBe(false);
  });
});
