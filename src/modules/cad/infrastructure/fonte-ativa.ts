import { Dinheiro } from '@/shared/kernel';
import { salarioDaFonte, type FonteAtiva, type SalariosCargo } from '../domain/cargo';
import { criarCifraSalarios, type CifraSalarios } from './cifra-salarios';

// O salário da Fonte Ativa de um cargo (C24, R19), decifrando só o campo que a fonte usa: o envelope
// ilegível de outro campo não impede o resultado. Usado pelo custo do cargo (US-051) e pelo acréscimo
// de C&S ao C2 (listarCargosExercicio). Sem server-only: roda também no worker.

export type CargoCifrado = {
  codigo: string;
  fonteAtiva: FonteAtiva | null;
  mercadoMinimo: { toFixed(n: number): string } | null;
  mercadoMaximo: { toFixed(n: number): string } | null;
  salarioRealCifrado: string | null;
  funcaoGratificadaCifrada: string | null;
  salarioDefinidoCifrado: string | null;
};

export const dinheiroDoDecimal = (d: { toFixed(n: number): string } | null) => (d === null ? null : Dinheiro.de(d.toFixed(2)));

const PRECISA: Record<FonteAtiva, readonly ('real' | 'definido' | 'funcaoGratificada')[]> = {
  REAL: ['real'],
  DEFINIDO: ['definido'],
  TOTAL: ['funcaoGratificada'],
  MINIMO: [],
  MAXIMO: [],
};

/** O salário da Fonte Ativa, ou null sem fonte ou sem valor nela. Envelope ilegível lança o ErroDominio da cifra. */
export function salarioFonteAtiva(c: CargoCifrado, cifraDada?: CifraSalarios | null): Dinheiro | null {
  if (!c.fonteAtiva) return null;
  let cifra = cifraDada ?? null;
  const decifrar = (envelope: string | null, campo: 'salario_real' | 'salario_definido' | 'funcao_gratificada') =>
    envelope === null ? null : (cifra ??= criarCifraSalarios()).decifrar(envelope, { codigoCargo: c.codigo, campo });
  const precisa = PRECISA[c.fonteAtiva];
  const salarios: SalariosCargo = {
    minimo: dinheiroDoDecimal(c.mercadoMinimo),
    maximo: dinheiroDoDecimal(c.mercadoMaximo),
    real: precisa.includes('real') ? decifrar(c.salarioRealCifrado, 'salario_real') : null,
    definido: precisa.includes('definido') ? decifrar(c.salarioDefinidoCifrado, 'salario_definido') : null,
    funcaoGratificada: precisa.includes('funcaoGratificada') ? decifrar(c.funcaoGratificadaCifrada, 'funcao_gratificada') : null,
  };
  const fonte = salarioDaFonte(salarios, c.fonteAtiva);
  return fonte === null || fonte.ehZero() ? null : fonte;
}
