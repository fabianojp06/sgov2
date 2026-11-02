import Decimal from 'decimal.js';
import { Dinheiro, falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { MENSAGENS_ORC as M } from './mensagens';
import type { DadosPacote, Prioridade } from './pacote';

// Validação da planilha-modelo (US-121; plano do P6, Task 4a). Função pura: as linhas chegam do
// leitor seguro do ger, e a estrutura financeira (C1) e o escopo (C25) chegam por parâmetro.

// Tipos do leitor do ger, copiados: o domínio não importa outro módulo.
export type LinhaPlanilha = { numero: number; celulas: Readonly<Record<string, string | null>> };
export type ErroLinha = { linha: number; coluna?: string; mensagem: string };

// Colunas de entrada do layout ADMC-ORC v1.0 (R6), exatamente como os cabeçalhos da linha 4.
export const LAYOUT = 'ADMC-ORC v1.0';
export const COLUNAS_PESSOAL = [
  'CC analítico',
  'Cargo',
  'Quantidade',
  'Salário mensal (R$)',
  'Mês de início (1–12)',
  'Mês de saída (1–12)',
  'Observação',
] as const;
export const COLUNAS_PACOTES = [
  'CC analítico',
  'Conta analítica',
  'Atividade / justificativa (mín. 10 caracteres)',
  'Prioridade',
  'Quantidade',
  'Valor unitário (R$)',
  'Corrigir pelo IPCA?',
  'Distribuição',
  'Mês (se pontual)',
] as const;
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'] as const;
export const COLUNAS_RECEITAS = ['TP / versão', 'Descrição', 'Situação', ...MESES] as const;
export const RAIZES_CONTAS_PESSOAL = ['4.1.1.1', '4.1.1.2'] as const; // §6.6 [PROVISÓRIA]

export type ConsultaEstrutura = { ccAnalitico(cc: string): boolean; contaPermitida(conta: string): boolean; noEscopo(cc: string): boolean };
export type LimitesPlanilha = { quantidadeMaxima: number }; // QUANTIDADE_MAXIMA do C2, passada pela aplicação

export type PosicaoValidada = {
  linha: number;
  cc: string;
  cargo: string;
  quantidade: number;
  salarioMensal: Dinheiro;
  mesInicio: number;
  mesSaida: number;
  observacao: string | null;
};
export type PacoteValidado = { linha: number; cc: string; conta: string; justificativa: string; prioridade: Prioridade } & DadosPacote;
export type ReceitaValidada = { linha: number; tp: string; descricao: string; situacao: 'CONFIRMADO' | 'PREVISTO'; meses: readonly Dinheiro[] };
export type ConteudoPlanilha = { posicoes: readonly PosicaoValidada[]; pacotes: readonly PacoteValidado[]; receitas: readonly ReceitaValidada[] };
export type Aba = 'Pessoal' | 'Pacotes base zero' | 'Receitas';
export type ErroPlanilha = ErroLinha & { aba: Aba };

const SALARIO_LIMITE = Dinheiro.de('1000000');
// Tetos para o cálculo caber em NUMERIC(15,2): 9.999 × valor unitário × (1 + IPCA) e 12 meses de receita.
const VALOR_UNITARIO_LIMITE = Dinheiro.de('100000000');
const MES_RECEITA_LIMITE = Dinheiro.de('100000000000');
const DIGITOS_MAXIMOS = 17;
const NUMERO = /^-?\d+(\.\d+)?$/;
const INTEIRO = /^\d+$/;
const FORMULA = /^[=+@]/; // R17: o "-" fica permitido

// Número como o leitor do ger entrega a célula numérica ("1234.56"). Texto com vírgula, ponto de
// milhar, "R$" ou expoente é inválido, e "7.500" (3 casas) também: nunca vira 7,5 em silêncio. O
// float que o LibreOffice grava ("1234.5599999999999", 15 ou mais dígitos significativos a menos
// de 1e-9 do valor com 2 casas) é aceito com o valor de 2 casas.
export function lerValor(celula: string | null): Dinheiro | null | 'INVALIDO' {
  const t = celula?.trim() ?? '';
  if (t === '') return null;
  if (!NUMERO.test(t)) return 'INVALIDO';
  try {
    if ((t.split('.')[1]?.length ?? 0) <= 2) return Dinheiro.de(t);
    const significativos = t.replace(/^-/, '').replace('.', '').replace(/^0+/, '').length;
    if (significativos < 15 || significativos > DIGITOS_MAXIMOS) return 'INVALIDO';
    const exato = new Decimal(t);
    const duasCasas = exato.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
    return exato.minus(duasCasas).abs().lessThan('1e-9') ? Dinheiro.de(duasCasas) : 'INVALIDO';
  } catch {
    return 'INVALIDO'; // fora do limite de NUMERIC(15,2)
  }
}

const texto = (c: string | null | undefined): string => (c ?? '').trim().normalize('NFC');
// Opções sem diferença de caixa, acento e espaços nas pontas: " importante " e "Importante".
const opcao = (c: string | null | undefined): string =>
  texto(c)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
// Opção pela tabela própria (Map): "constructor" ou "__proto__" não viram opção válida.
function escolher<T>(opcoes: ReadonlyMap<string, T>, c: string | null | undefined): T | undefined {
  return opcoes.get(opcao(c));
}
const inteiro = (c: string | null | undefined): number | null => (INTEIRO.test(texto(c)) ? Number(texto(c)) : null);
const mes = (c: string | null | undefined): number | null => {
  const n = inteiro(c);
  return n !== null && n >= 1 && n <= 12 ? n : null;
};
const formatarInteiro = (n: number) => new Intl.NumberFormat('pt-BR').format(n);

type Erros = { linha: number; aba: Aba; lista: ErroPlanilha[] };
const erro = (e: Erros, coluna: string, mensagem: string) => e.lista.push({ aba: e.aba, linha: e.linha, coluna, mensagem });
const vazia = (l: LinhaPlanilha, colunas: readonly string[]) => colunas.every((c) => texto(l.celulas[c]) === '');

// Texto obrigatório ou opcional, com limite e sem início de fórmula; undefined quando há erro.
function lerTexto(e: Erros, celulas: LinhaPlanilha['celulas'], coluna: string, regra: { obrigatorio?: string; maximo: number; rotulo: string }): string | undefined {
  const v = texto(celulas[coluna]);
  if (v === '' && regra.obrigatorio) return void erro(e, coluna, regra.obrigatorio);
  if (FORMULA.test(v)) return void erro(e, coluna, M.TEXTO_FORMULA);
  if (v.length > regra.maximo) return void erro(e, coluna, `${regra.rotulo} com mais de ${formatarInteiro(regra.maximo)} caracteres.`);
  return v;
}

function lerCc(e: Erros, celulas: LinhaPlanilha['celulas'], estrutura: ConsultaEstrutura): string | undefined {
  const cc = texto(celulas['CC analítico']);
  if (cc === '') return void erro(e, 'CC analítico', M.CC_OBRIGATORIO);
  if (!estrutura.ccAnalitico(cc)) return void erro(e, 'CC analítico', M.CC_NAO_ANALITICO);
  if (!estrutura.noEscopo(cc)) return void erro(e, 'CC analítico', M.CC_FORA_DO_ESCOPO);
  return cc;
}

function lerQuantidade(e: Erros, celulas: LinhaPlanilha['celulas'], limites: LimitesPlanilha): number | undefined {
  const q = inteiro(celulas['Quantidade']);
  if (q === null || q < 1 || q > limites.quantidadeMaxima) return void erro(e, 'Quantidade', M.QUANTIDADE(formatarInteiro(limites.quantidadeMaxima)));
  return q;
}

function lerPositivo(e: Erros, celulas: LinhaPlanilha['celulas'], coluna: string, mensagemZero: string): Dinheiro | undefined {
  const v = lerValor(celulas[coluna] ?? null);
  if (v === 'INVALIDO') return void erro(e, coluna, M.VALOR_FORMATO);
  if (v === null || v.ehNegativo() || v.ehZero()) return void erro(e, coluna, mensagemZero);
  return v;
}

function validarPessoal(l: LinhaPlanilha, estrutura: ConsultaEstrutura, limites: LimitesPlanilha, lista: ErroPlanilha[]): PosicaoValidada | null {
  const e: Erros = { linha: l.numero, aba: 'Pessoal', lista };
  const antes = lista.length;
  const c = l.celulas;
  const cc = lerCc(e, c, estrutura);
  const cargo = lerTexto(e, c, 'Cargo', { obrigatorio: M.CARGO_OBRIGATORIO, maximo: 120, rotulo: 'Cargo' });
  const quantidade = lerQuantidade(e, c, limites);
  let salario = lerPositivo(e, c, 'Salário mensal (R$)', M.SALARIO_ZERO);
  if (salario && salario.comparar(SALARIO_LIMITE) >= 0) salario = void erro(e, 'Salário mensal (R$)', M.SALARIO_LIMITE);
  const inicio = mes(c['Mês de início (1–12)']);
  if (inicio === null) erro(e, 'Mês de início (1–12)', M.MES_INVALIDO);
  const saida = mes(c['Mês de saída (1–12)']);
  if (saida === null) erro(e, 'Mês de saída (1–12)', M.MES_INVALIDO);
  if (inicio !== null && saida !== null && inicio > saida) erro(e, 'Mês de início (1–12)', M.INICIO_DEPOIS_DA_SAIDA);
  const observacao = lerTexto(e, c, 'Observação', { maximo: 500, rotulo: 'Observação' });
  if (lista.length > antes) return null;
  return {
    linha: l.numero,
    cc: cc!,
    cargo: cargo!,
    quantidade: quantidade!,
    salarioMensal: salario!,
    mesInicio: inicio!,
    mesSaida: saida!,
    observacao: observacao ? observacao : null,
  };
}

const PRIORIDADES = new Map<string, Prioridade>([
  ['essencial', 'ESSENCIAL'],
  ['importante', 'IMPORTANTE'],
  ['desejavel', 'DESEJAVEL'],
]);
const SIM_NAO = new Map([
  ['sim', true],
  ['nao', false],
]);
const DISTRIBUICOES = new Map<string, 'MENSAL' | 'PONTUAL'>([
  ['mensal', 'MENSAL'],
  ['pontual', 'PONTUAL'],
]);
const SITUACOES = new Map<string, 'CONFIRMADO' | 'PREVISTO'>([
  ['confirmado', 'CONFIRMADO'],
  ['previsto', 'PREVISTO'],
]);
const JUSTIFICATIVA = 'Atividade / justificativa (mín. 10 caracteres)';

function validarPacote(l: LinhaPlanilha, estrutura: ConsultaEstrutura, limites: LimitesPlanilha, lista: ErroPlanilha[]): PacoteValidado | null {
  const e: Erros = { linha: l.numero, aba: 'Pacotes base zero', lista };
  const antes = lista.length;
  const c = l.celulas;
  const cc = lerCc(e, c, estrutura);
  const conta = texto(c['Conta analítica']);
  if (!estrutura.contaPermitida(conta)) erro(e, 'Conta analítica', M.CONTA_NAO_PERMITIDA);
  let justificativa = lerTexto(e, c, JUSTIFICATIVA, { obrigatorio: M.JUSTIFICATIVA_CURTA, maximo: 1000, rotulo: 'Justificativa' });
  if (justificativa !== undefined && justificativa.length < 10) justificativa = void erro(e, JUSTIFICATIVA, M.JUSTIFICATIVA_CURTA);
  const prioridade = escolher(PRIORIDADES, c['Prioridade']);
  if (!prioridade) erro(e, 'Prioridade', M.PRIORIDADE);
  const quantidade = lerQuantidade(e, c, limites);
  let valorUnitario = lerPositivo(e, c, 'Valor unitário (R$)', M.VALOR_UNITARIO_ZERO);
  if (valorUnitario && valorUnitario.comparar(VALOR_UNITARIO_LIMITE) >= 0) valorUnitario = void erro(e, 'Valor unitário (R$)', M.VALOR_UNITARIO_LIMITE);
  const ipca = escolher(SIM_NAO, c['Corrigir pelo IPCA?']);
  if (ipca === undefined) erro(e, 'Corrigir pelo IPCA?', M.IPCA);
  const distribuicao = escolher(DISTRIBUICOES, c['Distribuição']);
  if (!distribuicao) erro(e, 'Distribuição', M.DISTRIBUICAO);
  const mesOcorrencia = distribuicao === 'PONTUAL' ? mes(c['Mês (se pontual)']) : null;
  if (distribuicao === 'PONTUAL' && mesOcorrencia === null) erro(e, 'Mês (se pontual)', M.MES_INVALIDO);
  if (lista.length > antes) return null;
  return {
    linha: l.numero,
    cc: cc!,
    conta,
    justificativa: justificativa!,
    prioridade: prioridade!,
    quantidade: quantidade!,
    valorUnitario: valorUnitario!,
    corrigirIpca: ipca!,
    distribuicao: distribuicao!,
    mesOcorrencia,
  };
}

// Uma linha de receita (aba Receitas ou tela da Task 5). Os campos dos erros são os nomes das colunas.
export function validarReceita(celulas: LinhaPlanilha['celulas']): Resultado<Omit<ReceitaValidada, 'linha'>> {
  const lista: ErroPlanilha[] = [];
  const e: Erros = { linha: 0, aba: 'Receitas', lista };
  const tp = lerTexto(e, celulas, 'TP / versão', { obrigatorio: M.TP_OBRIGATORIO, maximo: 60, rotulo: 'TP / versão' });
  const descricao = lerTexto(e, celulas, 'Descrição', { maximo: 200, rotulo: 'Descrição' });
  const situacao = escolher(SITUACOES, celulas['Situação']);
  if (!situacao) erro(e, 'Situação', M.SITUACAO_RECEITA);
  const meses = MESES.map((m) => {
    const v = lerValor(celulas[m] ?? null);
    if (v === 'INVALIDO') return void erro(e, m, M.VALOR_FORMATO);
    if (v?.ehNegativo()) return void erro(e, m, M.MES_NEGATIVO);
    if (v && v.comparar(MES_RECEITA_LIMITE) >= 0) return void erro(e, m, M.MES_RECEITA_LIMITE);
    return v ?? Dinheiro.zero();
  });
  if (lista.length > 0) return falha(lista.map((x): ErroCampo => ({ campo: x.coluna ?? '_', mensagem: x.mensagem })));
  return ok({ tp: tp!, descricao: descricao ?? '', situacao: situacao!, meses: meses as Dinheiro[] });
}

export function validarPlanilha(
  abas: { pessoal: readonly LinhaPlanilha[]; pacotes: readonly LinhaPlanilha[]; receitas: readonly LinhaPlanilha[] },
  estrutura: ConsultaEstrutura,
  limites: LimitesPlanilha,
): { ok: true; conteudo: ConteudoPlanilha } | { ok: false; erros: readonly ErroPlanilha[] } {
  const lista: ErroPlanilha[] = [];
  const posicoes: PosicaoValidada[] = [];
  for (const l of abas.pessoal) {
    if (vazia(l, COLUNAS_PESSOAL)) continue;
    const p = validarPessoal(l, estrutura, limites, lista);
    if (p) posicoes.push(p);
  }
  const pacotes: PacoteValidado[] = [];
  for (const l of abas.pacotes) {
    if (vazia(l, COLUNAS_PACOTES)) continue;
    const p = validarPacote(l, estrutura, limites, lista);
    if (p) pacotes.push(p);
  }
  const receitas: ReceitaValidada[] = [];
  const linhasPorTp = new Map<string, number[]>();
  for (const l of abas.receitas) {
    if (vazia(l, COLUNAS_RECEITAS)) continue;
    // A repetição de TP aparece mesmo se a linha tiver outro erro.
    const tp = texto(l.celulas['TP / versão']);
    if (tp !== '') linhasPorTp.set(tp, [...(linhasPorTp.get(tp) ?? []), l.numero]);
    const r = validarReceita(l.celulas);
    if (!r.ok) {
      for (const x of r.erros) lista.push({ aba: 'Receitas', linha: l.numero, coluna: x.campo, mensagem: x.mensagem });
      continue;
    }
    receitas.push({ linha: l.numero, ...r.valor });
  }
  for (const linhas of linhasPorTp.values()) {
    if (linhas.length < 2) continue;
    for (const linha of linhas) lista.push({ aba: 'Receitas', linha, coluna: 'TP / versão', mensagem: M.TP_REPETIDO(linhas) });
  }
  if (lista.length > 0) {
    const ordem: Record<Aba, number> = { Pessoal: 0, 'Pacotes base zero': 1, Receitas: 2 };
    return { ok: false, erros: lista.map((x, i) => ({ x, i })).sort((a, b) => ordem[a.x.aba] - ordem[b.x.aba] || a.x.linha - b.x.linha || a.i - b.i).map(({ x }) => x) };
  }
  return { ok: true, conteudo: { posicoes, pacotes, receitas } };
}
