import type { FonteAtiva, GrauInsalubridade } from './cargo';

// O cargo como dado da tela (US-049 parte 2; plano do P4, Task 12b; R24). Só texto e números: vai ao
// componente cliente. Sem a permissão cad.salarios, os salários e o desvio vêm nulos e `mascarado`.

export type SalariosTela = { minimo: string | null; maximo: string | null; funcaoGratificada: string | null; real: string | null; definido: string | null };
export type AdicionalTela = { tipo: 'PERICULOSIDADE' } | { tipo: 'INSALUBRIDADE'; grau: GrauInsalubridade } | null;

export type CargoTela = {
  id: string;
  codigo: string;
  nomeOficial: string;
  nomeMercado: string | null;
  /** "[código] — [descrição]" (RN_CAR_09). */
  tabelaSalarial: string | null;
  faixa: string | null;
  nivel: string | null;
  /** Null se vazio ou mascarado. Mínimo e máximo são de mercado (em claro), mas também se mascaram (R24). */
  salarios: SalariosTela;
  mascarado: boolean;
  origemMercado: string | null;
  fonteAtiva: FonteAtiva | null;
  /** Salário da fonte ativa; null sem fonte, sem valor ou mascarado. */
  salarioDaFonte: string | null;
  adicional: AdicionalTela;
  desvioDeMercado: 'ABAIXO' | 'DENTRO' | 'ACIMA' | null;
  /** Envelopes que não voltaram (chave fora do keyring, adulteração): esses campos vêm nulos e não vão no envio. */
  salariosIlegiveis: readonly ('funcaoGratificada' | 'real' | 'definido')[];
  ativo: boolean;
  versao: number;
};

export const ROTULO_FONTE: Readonly<Record<FonteAtiva, string>> = {
  MINIMO: 'Salário mínimo',
  MAXIMO: 'Salário máximo',
  TOTAL: 'Salário total (máximo + função gratificada)',
  REAL: 'Salário real',
  DEFINIDO: 'Salário definido',
};

export const ROTULO_DESVIO: Readonly<Record<NonNullable<CargoTela['desvioDeMercado']>, string>> = {
  ABAIXO: 'Abaixo do mercado',
  DENTRO: 'Dentro do mercado',
  ACIMA: 'Acima do mercado',
};

/** RN_CAR_09: "[código] — [descrição]"; sem os dois, null. */
export function codigoDescricao(codigo: string | null, descricao: string | null): string | null {
  if (!codigo && !descricao) return null;
  return [codigo, descricao].filter(Boolean).join(' — ');
}
