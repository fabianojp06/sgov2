import { Dinheiro, falha, ok, Percentual, type ErroCampo, type Resultado } from '@/shared/kernel';

// Tabela Mestre de Benefícios por exercício (US-050; plano do P4, Task 10, R12). Pura.

export const FORMAS_BENEFICIO = ['VALOR_MENSAL', 'VALOR_DIARIO', 'PERCENTUAL_SALARIO'] as const;
export type FormaBeneficio = (typeof FORMAS_BENEFICIO)[number];

export type BeneficioMestre = {
  codigo: `beneficio.${string}`;
  nome: string;
  forma: FormaBeneficio;
  /** Por pessoa: por mês (VALOR_MENSAL) ou por dia útil (VALOR_DIARIO); null sem valor ainda. */
  valor: Dinheiro | null;
  /** Sobre o salário do mês (PERCENTUAL_SALARIO, R14a), em pontos. */
  percentual: Percentual | null;
  conta: string;
  /** Entra na posição sem cargo (C34, pendência P6). */
  padraoPosicao: boolean;
  ativo: boolean;
  provisorio: boolean;
  versao: number;
};

/** O que a tela manda: valores como texto (ponto ou vírgula decimal), nunca number. */
export type EntradaBeneficio = {
  codigo: string;
  nome: string;
  forma: FormaBeneficio;
  valor: string | null;
  percentual: string | null;
  conta: string;
  padraoPosicao: boolean;
  ativo: boolean;
};

export type BeneficioValidado = Omit<BeneficioMestre, 'versao' | 'provisorio' | 'codigo'> & { codigo: `beneficio.${string}` };

const FORMATO_CODIGO = /^beneficio\.[a-z][a-z0-9_]{0,40}$/;
const TEXTO_DINHEIRO = /^\d{1,13}(\.\d{1,2})?$/;
const TEXTO_PERCENTUAL = /^\d{1,3}(\.\d{1,4})?$/;
const normalizar = (s: string) => {
  const t = s.trim();
  return t.includes(',') && !t.includes('.') ? t.replace(',', '.') : t;
};

/** Validação da entrada; a conta é conferida pela função injetada (analítica ativa, pelo C1). */
export function validarBeneficio(e: EntradaBeneficio, contaValida: (classificacao: string) => boolean): Resultado<BeneficioValidado> {
  const erros: ErroCampo[] = [];
  if (!FORMATO_CODIGO.test(e.codigo)) {
    erros.push({ campo: 'codigo', mensagem: 'O código deve ser "beneficio." seguido de letras minúsculas, números ou _.' });
  }
  const nome = e.nome.trim();
  if (nome === '' || nome.length > 120) erros.push({ campo: 'nome', mensagem: 'O nome é obrigatório, com até 120 caracteres.' });
  if (!(FORMAS_BENEFICIO as readonly string[]).includes(e.forma)) erros.push({ campo: 'forma', mensagem: 'Forma de benefício inválida.' });
  if (!contaValida(e.conta)) erros.push({ campo: 'conta', mensagem: 'A conta deve ser analítica e ativa.' });

  let valor: Dinheiro | null = null;
  let percentual: Percentual | null = null;
  if (e.forma === 'PERCENTUAL_SALARIO') {
    if (e.valor !== null && e.valor.trim() !== '') erros.push({ campo: 'valor', mensagem: 'O benefício percentual não tem valor em reais.' });
    if (e.percentual === null || e.percentual.trim() === '') {
      erros.push({ campo: 'percentual', mensagem: 'Informe o percentual sobre o salário.' });
    } else if (!TEXTO_PERCENTUAL.test(normalizar(e.percentual)) || Percentual.dePontos(normalizar(e.percentual)).comoFracao().gt(1)) {
      erros.push({ campo: 'percentual', mensagem: 'Informe um percentual de 0 a 100, com até 4 casas.' });
    } else percentual = Percentual.dePontos(normalizar(e.percentual));
  } else {
    if (e.percentual !== null && e.percentual.trim() !== '') erros.push({ campo: 'percentual', mensagem: 'O benefício em valor não tem percentual.' });
    if (e.valor !== null && e.valor.trim() !== '') {
      if (!TEXTO_DINHEIRO.test(normalizar(e.valor))) erros.push({ campo: 'valor', mensagem: 'Informe um valor maior ou igual a zero, com até 2 casas.' });
      else valor = Dinheiro.de(normalizar(e.valor));
    }
  }
  if (erros.length > 0) return falha(erros);
  return ok({
    codigo: e.codigo as `beneficio.${string}`,
    nome,
    forma: e.forma,
    valor,
    percentual,
    conta: e.conta,
    padraoPosicao: e.padraoPosicao,
    ativo: e.ativo,
  });
}

/** Valor mensal por pessoa: diário × dias úteis; mensal como está; percentual depende do salário → null. */
export function valorMensalPorPessoa(b: Pick<BeneficioMestre, 'forma' | 'valor'>, diasUteisMes: number): Dinheiro | null {
  if (b.valor === null) return null;
  if (b.forma === 'VALOR_DIARIO') return b.valor.multiplicar(String(diasUteisMes));
  if (b.forma === 'VALOR_MENSAL') return b.valor;
  return null;
}
