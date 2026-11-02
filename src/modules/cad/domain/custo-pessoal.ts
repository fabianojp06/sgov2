import { falha, ok, type Dinheiro, type ErroCampo, type Percentual, type Resultado } from '@/shared/kernel';

// C2 — Custo de pessoal (spec §6.4, §6.6, C33; plano do P4, Task 3). Mês 1 = janeiro; as séries
// têm sempre 12 posições. Valores em Dinheiro (NUMERIC(15,2), Half-Even); number só para contagem e mês.

/**
 * Adicional da posição. Periculosidade: 30% sobre o salário do mês (RN_CAR_10). Insalubridade:
 * 10/20/40% sobre o salário mínimo nacional, sem reajuste (RN_CAR_11).
 */
export type AdicionalTrabalhista =
  | { tipo: 'PERICULOSIDADE' }
  | { tipo: 'INSALUBRIDADE'; grau: 'MINIMO' | 'MEDIO' | 'MAXIMO' };

export type PosicaoPessoal = {
  /** Inteiro ≥ 1 (contagem de pessoas). */
  quantidade: number;
  /** > 0; Fonte Ativa do cargo ou o salário digitado (C34). */
  salarioMensal: Dinheiro;
  /** 1..12. */
  mesInicio: number;
  /** mesInicio..12. */
  mesSaida: number;
  adicional?: AdicionalTrabalhista;
};

/** Componentes fixos do custo, na ordem de cálculo da R14. Os benefícios são `beneficio.<nome>`. */
export const COMPONENTES_FIXOS = [
  'salario',
  'adicional',
  'ferias',
  'decimo_terceiro',
  'encargo.inss',
  'encargo.fgts',
  'encargo.pis',
  'encargo.obrigacoes',
  'encargo.riscos',
] as const;
export type ComponenteFixo = (typeof COMPONENTES_FIXOS)[number];
export type ComponenteEncargo = Extract<ComponenteFixo, `encargo.${string}`>;
export type CodigoComponente = ComponenteFixo | `beneficio.${string}`;

/**
 * Benefício por pessoa. VALOR_MENSAL: valor × quantidade, exato. PERCENTUAL_SALARIO: sobre o
 * salário do mês, já reajustado, de toda a posição, com um arredondamento (R14a).
 */
export type BeneficioPremissa =
  | { componente: `beneficio.${string}`; nome: string; forma: 'VALOR_MENSAL'; valorMensal: Dinheiro; conta: string }
  | { componente: `beneficio.${string}`; nome: string; forma: 'PERCENTUAL_SALARIO'; percentual: Percentual; conta: string };

/** Parâmetros do exercício (US-053). Contas são classificações de analíticas ativas (C1). */
export type PremissasExercicio = {
  ano: number;
  /**
   * Muda com QUALQUER escrita nos parâmetros do ano: premissas, encargos, contas por componente,
   * SMN e Tabela Mestre (R10). O consumidor guarda a versão para saber se a série está velha.
   */
  versao: number;
  /** Congelado quando a frente A oficializa o exercício: nenhuma escrita depois disso. */
  congelado: boolean;
  /** Ainda com os padrões provisórios do seed. */
  provisorio: boolean;
  /** Em pontos: 5 = 5%. Vale a partir de `mesDataBase`. */
  reajuste: Percentual;
  /** 1..12. */
  mesDataBase: number;
  ipca: Percentual;
  /** Necessário só para a insalubridade. */
  salarioMinimo: Dinheiro | null;
  /**
   * R13: o total é a base × soma dos percentuais, com um único Half-Even; cada componente é
   * arredondado em separado e a diferença de centavo vai para o INSS.
   */
  encargos: readonly { componente: ComponenteEncargo; nome: string; percentual: Percentual; conta: string }[];
  /** Conta analítica de cada componente fixo que não é encargo (R14). */
  contas: Readonly<Record<Exclude<ComponenteFixo, ComponenteEncargo>, string>>;
  beneficios: readonly BeneficioPremissa[];
  avisos: readonly string[];
};

export type LinhaComponente = { componente: CodigoComponente; conta: string; meses: readonly Dinheiro[]; total: Dinheiro };

export type SerieMensalComponentes = {
  ano: number;
  versaoPremissas: number;
  /** Só os componentes com algum mês diferente de zero. */
  linhas: readonly LinhaComponente[];
  /** 12 posições. */
  totalMes: readonly Dinheiro[];
  total: Dinheiro;
};

const ehMes = (m: number) => Number.isInteger(m) && m >= 1 && m <= 12;

/** Validação da posição, igual no falso e no motor real. Erros por campo ([TRAVA O ERRO]). */
export function validarPosicao(posicao: PosicaoPessoal, premissas: PremissasExercicio): Resultado<PosicaoPessoal> {
  const erros: ErroCampo[] = [];
  if (!Number.isInteger(posicao.quantidade) || posicao.quantidade < 1) {
    erros.push({ campo: 'quantidade', mensagem: 'A quantidade deve ser um número inteiro a partir de 1.' });
  }
  if (posicao.salarioMensal.ehNegativo() || posicao.salarioMensal.ehZero()) {
    erros.push({ campo: 'salarioMensal', mensagem: 'O salário mensal deve ser maior que zero.' });
  }
  if (!ehMes(posicao.mesInicio)) erros.push({ campo: 'mesInicio', mensagem: 'O mês de início deve ser de 1 a 12.' });
  if (!ehMes(posicao.mesSaida) || (ehMes(posicao.mesInicio) && posicao.mesSaida < posicao.mesInicio)) {
    erros.push({ campo: 'mesSaida', mensagem: 'O mês de saída deve ser de 1 a 12 e não pode ser anterior ao de início.' });
  }
  if (posicao.adicional?.tipo === 'INSALUBRIDADE' && premissas.salarioMinimo === null) {
    erros.push({ campo: 'adicional', mensagem: 'A insalubridade precisa do salário mínimo do exercício, que não está cadastrado.' });
  }
  return erros.length > 0 ? falha(erros) : ok(posicao);
}
