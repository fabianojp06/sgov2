import { Dinheiro, falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import type { ErroLinha, LinhaLida } from './plano-contas';

// Cargos e salários (US-049; plano do P4, Task 12a; R7, R11, R19, R20). Puro.

/** C20: DEFINIDO é a 5ª opção [PROVISÓRIA]. */
export const FONTES_ATIVAS = ['MINIMO', 'MAXIMO', 'TOTAL', 'REAL', 'DEFINIDO'] as const;
export type FonteAtiva = (typeof FONTES_ATIVAS)[number];

/** Mínimo e máximo vêm da pesquisa de mercado ou da tabela salarial (em claro); os outros, cifrados (R7). */
export type SalariosCargo = {
  minimo: Dinheiro | null;
  maximo: Dinheiro | null;
  funcaoGratificada: Dinheiro | null;
  real: Dinheiro | null;
  definido: Dinheiro | null;
};

/** R19 [PROVISÓRIA, P4]: Máximo + Função Gratificada; sem FG, o máximo; sem máximo, null. */
export function salarioTotal(s: SalariosCargo): Dinheiro | null {
  if (s.maximo === null) return null;
  return s.funcaoGratificada === null ? s.maximo : s.maximo.somar(s.funcaoGratificada);
}

export function salarioDaFonte(s: SalariosCargo, fonte: FonteAtiva): Dinheiro | null {
  switch (fonte) {
    case 'MINIMO':
      return s.minimo;
    case 'MAXIMO':
      return s.maximo;
    case 'TOTAL':
      return salarioTotal(s);
    case 'REAL':
      return s.real;
    case 'DEFINIDO':
      return s.definido;
  }
}

/** REQ_CAR_005: o salário real contra a faixa de mercado; sem algum dos três, null. */
export function desvioDeMercado(s: SalariosCargo): 'ABAIXO' | 'DENTRO' | 'ACIMA' | null {
  if (s.real === null || s.minimo === null || s.maximo === null) return null;
  if (s.real.comparar(s.minimo) < 0) return 'ABAIXO';
  if (s.real.comparar(s.maximo) > 0) return 'ACIMA';
  return 'DENTRO';
}

// ---- Campos manuais (Task 12b grava; aqui a regra) ----

export const GRAUS_INSALUBRIDADE = ['MINIMO', 'MEDIO', 'MAXIMO'] as const;
export type GrauInsalubridade = (typeof GRAUS_INSALUBRIDADE)[number];

export const MSG_DOIS_ADICIONAIS = 'Um cargo pode ter apenas um adicional trabalhista: Periculosidade OU Insalubridade.';

/** O que a tela manda: valores em texto (ponto ou vírgula decimal), nunca number. */
export type EntradaMercadoCargo = {
  mercadoMinimo: string | null;
  mercadoMaximo: string | null;
  periculosidade: boolean;
  insalubridade: GrauInsalubridade | null;
};

export type MercadoCargoValidado = {
  mercadoMinimo: Dinheiro | null;
  mercadoMaximo: Dinheiro | null;
  adicional: { tipo: 'PERICULOSIDADE' } | { tipo: 'INSALUBRIDADE'; grau: GrauInsalubridade } | null;
};

const TEXTO_DINHEIRO = /^\d{1,13}(\.\d{1,2})?$/;
// "7500,00", "7500.00" e o formato brasileiro com milhar ("7.500,00").
const normalizar = (s: string) => {
  const t = s.trim();
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(t)) return t.replace(/\./g, '').replace(',', '.');
  return t.includes(',') && !t.includes('.') ? t.replace(',', '.') : t;
};

/** Dinheiro digitado, ou null se em branco; formato inválido devolve 'invalido'. */
export function dinheiroDoTexto(texto: string | null): Dinheiro | null | 'invalido' {
  if (texto === null || texto.trim() === '') return null;
  const t = normalizar(texto);
  return TEXTO_DINHEIRO.test(t) ? Dinheiro.de(t) : 'invalido';
}

/** E3 (mínimo < máximo, erro nos dois campos) e E5 / RN_CAR_12 (um adicional só). */
export function validarMercadoCargo(e: EntradaMercadoCargo): Resultado<MercadoCargoValidado> {
  const erros: ErroCampo[] = [];
  const minimo = dinheiroDoTexto(e.mercadoMinimo);
  const maximo = dinheiroDoTexto(e.mercadoMaximo);
  if (minimo === 'invalido') erros.push({ campo: 'mercadoMinimo', mensagem: 'Informe o valor com até 2 casas decimais.' });
  if (maximo === 'invalido') erros.push({ campo: 'mercadoMaximo', mensagem: 'Informe o valor com até 2 casas decimais.' });
  if (minimo instanceof Dinheiro && maximo instanceof Dinheiro && minimo.comparar(maximo) >= 0) {
    const mensagem = 'O salário mínimo deve ser menor que o máximo.';
    erros.push({ campo: 'mercadoMinimo', mensagem }, { campo: 'mercadoMaximo', mensagem });
  }
  if (e.periculosidade && e.insalubridade !== null) erros.push({ campo: 'adicional', mensagem: MSG_DOIS_ADICIONAIS });
  if (e.insalubridade !== null && !(GRAUS_INSALUBRIDADE as readonly string[]).includes(e.insalubridade)) {
    erros.push({ campo: 'adicional', mensagem: 'Grau de insalubridade inválido.' });
  }
  if (erros.length > 0) return falha(erros);
  return ok({
    mercadoMinimo: minimo as Dinheiro | null,
    mercadoMaximo: maximo as Dinheiro | null,
    adicional: e.periculosidade ? { tipo: 'PERICULOSIDADE' } : e.insalubridade ? { tipo: 'INSALUBRIDADE', grau: e.insalubridade } : null,
  });
}

// ---- Importação do Rubi (R20, layout CAD-CARGOS v1.0, pendência P3) ----

export const COLUNAS_CARGOS = [
  'Código do Cargo',
  'Cargo',
  'Cargo Mercado',
  'Tabela Salarial (código)',
  'Tabela Salarial (descrição)',
  'Faixa (código)',
  'Faixa (descrição)',
  'Nível (código)',
  'Nível (descrição)',
  'Salário Real',
] as const;

/** Colunas que o leitor deve manter como texto (os códigos: "007" não vira 7). O salário pode vir como número. */
export const COLUNAS_TEXTO_CARGOS = ['Código do Cargo', 'Tabela Salarial (código)', 'Faixa (código)', 'Nível (código)'] as const;

export type LinhaCargoValidada = {
  linha: number;
  codigo: string;
  nomeOficial: string;
  nomeMercado: string | null;
  tabelaSalarialCodigo: string | null;
  tabelaSalarialDescricao: string | null;
  faixaCodigo: string | null;
  faixaDescricao: string | null;
  nivelCodigo: string | null;
  nivelDescricao: string | null;
  /** Em claro só aqui, na memória do app: vai cifrado para o staging (R7). */
  salarioReal: Dinheiro | null;
};

export type ResultadoValidacaoCargos =
  | { ok: true; cargos: readonly LinhaCargoValidada[]; avisos: readonly ErroLinha[] }
  | { ok: false; erros: readonly ErroLinha[] };

const FORMATO_CODIGO = /^[A-Za-z0-9._-]{1,30}$/;
const LIMITE_TEXTO = 200;
const LIMITE_SALARIO = Dinheiro.de('10000000.00');

/**
 * Valida as linhas do Rubi. I9: as mensagens da coluna "Salário Real" citam só a linha e a coluna,
 * nunca o valor. Código obrigatório, no formato e único; nome oficial obrigatório.
 */
export function validarCargosRubi(linhas: readonly LinhaLida[], sanear: (texto: string) => { texto: string; retirou: boolean }): ResultadoValidacaoCargos {
  const erros: ErroLinha[] = [];
  const avisos: ErroLinha[] = [];
  if (linhas.length === 0) return { ok: false, erros: [{ linha: 0, mensagem: 'A planilha não tem cargos.' }] };
  const cargos: LinhaCargoValidada[] = [];
  const primeira = new Map<string, number>();
  const texto = (numero: number, coluna: (typeof COLUNAS_CARGOS)[number], v: string | null | undefined, obrigatorio = false): string | null => {
    const s = v === null || v === undefined ? null : sanear(v);
    const t = s?.texto.trim() ?? '';
    if (s?.retirou) avisos.push({ linha: numero, coluna, mensagem: 'O nome da instituição foi retirado do texto.' });
    if (t === '') {
      if (obrigatorio) erros.push({ linha: numero, coluna, mensagem: `A coluna "${coluna}" é obrigatória.` });
      return null;
    }
    if (t.length > LIMITE_TEXTO) erros.push({ linha: numero, coluna, mensagem: `O texto deve ter até ${LIMITE_TEXTO} caracteres.` });
    return t;
  };
  for (const { numero, celulas } of linhas) {
    const codigo = (celulas['Código do Cargo'] ?? '').trim();
    if (!FORMATO_CODIGO.test(codigo)) {
      erros.push({ linha: numero, coluna: 'Código do Cargo', mensagem: 'O código do cargo deve ter até 30 letras, números, ponto, hífen ou sublinhado.' });
    } else {
      const antes = primeira.get(codigo);
      if (antes === undefined) primeira.set(codigo, numero);
      else {
        erros.push({ linha: antes, coluna: 'Código do Cargo', mensagem: `Código do cargo repetido na linha ${numero}.` });
        erros.push({ linha: numero, coluna: 'Código do Cargo', mensagem: `Código do cargo repetido na linha ${antes}.` });
      }
    }
    const salarioTexto = celulas['Salário Real'] ?? null;
    const salario = dinheiroDoTexto(salarioTexto);
    if (salario === 'invalido' || (salario instanceof Dinheiro && (salario.ehZero() || salario.comparar(LIMITE_SALARIO) >= 0))) {
      // I9: sem o valor na mensagem.
      erros.push({ linha: numero, coluna: 'Salário Real', mensagem: 'Salário inválido: informe um valor maior que zero, com até 2 casas decimais.' });
    }
    cargos.push({
      linha: numero,
      codigo,
      nomeOficial: texto(numero, 'Cargo', celulas['Cargo'], true) ?? '',
      nomeMercado: texto(numero, 'Cargo Mercado', celulas['Cargo Mercado']),
      tabelaSalarialCodigo: texto(numero, 'Tabela Salarial (código)', celulas['Tabela Salarial (código)']),
      tabelaSalarialDescricao: texto(numero, 'Tabela Salarial (descrição)', celulas['Tabela Salarial (descrição)']),
      faixaCodigo: texto(numero, 'Faixa (código)', celulas['Faixa (código)']),
      faixaDescricao: texto(numero, 'Faixa (descrição)', celulas['Faixa (descrição)']),
      nivelCodigo: texto(numero, 'Nível (código)', celulas['Nível (código)']),
      nivelDescricao: texto(numero, 'Nível (descrição)', celulas['Nível (descrição)']),
      salarioReal: salario instanceof Dinheiro ? salario : null,
    });
  }
  if (erros.length > 0) return { ok: false, erros: erros.sort((a, b) => a.linha - b.linha) };
  return { ok: true, cargos, avisos };
}
