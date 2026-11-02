import { describe, expect, it } from 'vitest';
import { Dinheiro } from '@/shared/kernel';
import {
  COLUNAS_PACOTES,
  COLUNAS_PESSOAL,
  COLUNAS_RECEITAS,
  lerValor,
  validarPlanilha,
  validarReceita,
  type ConsultaEstrutura,
  type LinhaPlanilha,
} from './planilha';

// Validação da planilha-modelo ADMC-ORC v1.0 (plano do P6, Task 4a; spec §6.6).
const estrutura: ConsultaEstrutura = {
  ccAnalitico: (cc) => ['4.4', '4.3.0', '4.3.2.10'].includes(cc),
  contaPermitida: (conta) => ['4.1.1.5.005', '4.1.1.4.001'].includes(conta),
  noEscopo: (cc) => cc !== '4.3.2.10',
};
const LIMITES = { quantidadeMaxima: 9999 };

const linha = (numero: number, celulas: Record<string, string | null>): LinhaPlanilha => ({ numero, celulas });
const pessoal = (numero: number, c: Partial<Record<(typeof COLUNAS_PESSOAL)[number], string | null>> = {}) =>
  linha(numero, {
    'CC analítico': '4.4',
    Cargo: 'Analista de orçamento',
    Quantidade: '2',
    'Salário mensal (R$)': '7500',
    'Mês de início (1–12)': '1',
    'Mês de saída (1–12)': '12',
    Observação: null,
    ...c,
  });
const pacote = (numero: number, c: Partial<Record<(typeof COLUNAS_PACOTES)[number], string | null>> = {}) =>
  linha(numero, {
    'CC analítico': '4.4',
    'Conta analítica': '4.1.1.5.005',
    'Atividade / justificativa (mín. 10 caracteres)': 'Reposição anual de material de escritório',
    Prioridade: 'Importante',
    Quantidade: '12',
    'Valor unitário (R$)': '350',
    'Corrigir pelo IPCA?': 'Sim',
    Distribuição: 'Mensal',
    'Mês (se pontual)': null,
    ...c,
  });
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'] as const;
const receita = (numero: number, c: Record<string, string | null> = {}) =>
  linha(numero, { 'TP / versão': '001/2026', Descrição: 'Contrato de apoio técnico', Situação: 'Confirmado', ...Object.fromEntries(MESES.map((m) => [m, '1000'])), ...c });

const validar = (abas: Partial<{ pessoal: LinhaPlanilha[]; pacotes: LinhaPlanilha[]; receitas: LinhaPlanilha[] }>) =>
  validarPlanilha({ pessoal: abas.pessoal ?? [], pacotes: abas.pacotes ?? [], receitas: abas.receitas ?? [] }, estrutura, LIMITES);
const erros = (r: ReturnType<typeof validar>) => (r.ok ? [] : r.erros.map((e) => `${e.aba}:${e.linha}:${e.coluna ?? ''}:${e.mensagem}`));

describe('colunas do layout ADMC-ORC v1.0', () => {
  it('as colunas de entrada, como os cabeçalhos do gerador', () => {
    expect(COLUNAS_PESSOAL).toContain('Mês de início (1–12)');
    expect(COLUNAS_PACOTES).toHaveLength(9);
    expect(COLUNAS_RECEITAS).toHaveLength(15);
  });
});

describe('lerValor (Review Focus 2)', () => {
  it.each([
    ['7500', '7500.00'],
    ['7500.5', '7500.50'],
    ['0.01', '0.01'],
    ['1234.5599999999999', '1234.56'],
  ])('%s → %s', (entrada, saida) => expect((lerValor(entrada) as Dinheiro).paraString()).toBe(saida));

  it.each(['7.500', '7.500,00', 'R$ 350', '1.5e3', '10.123', '7500.004999999', '1 000', 'abc', '--1'])('%j → INVALIDO', (v) =>
    expect(lerValor(v)).toBe('INVALIDO'),
  );

  it('vazio e null → null; negativo é lido (a regra do campo decide)', () => {
    expect(lerValor('')).toBeNull();
    expect(lerValor('  ')).toBeNull();
    expect(lerValor(null)).toBeNull();
    expect((lerValor('-100') as Dinheiro).paraString()).toBe('-100.00');
  });
});

describe('validarPlanilha: Pessoal', () => {
  it('linha válida vira posição; observação vazia → null; linha toda vazia é ignorada', () => {
    const vazia = linha(9, Object.fromEntries(COLUNAS_PESSOAL.map((c) => [c, null])));
    const r = validar({ pessoal: [pessoal(5, { Observação: '  Quadro atual ' }), vazia, pessoal(6)] });
    expect(r.ok && r.conteudo.posicoes).toEqual([
      { linha: 5, cc: '4.4', cargo: 'Analista de orçamento', quantidade: 2, salarioMensal: Dinheiro.de('7500'), mesInicio: 1, mesSaida: 12, observacao: 'Quadro atual' },
      { linha: 6, cc: '4.4', cargo: 'Analista de orçamento', quantidade: 2, salarioMensal: Dinheiro.de('7500'), mesInicio: 1, mesSaida: 12, observacao: null },
    ]);
  });

  it('erros por campo, com a linha e a coluna', () => {
    const r = validar({
      pessoal: [
        pessoal(5, { 'CC analítico': '4.3' }),
        pessoal(6, { 'CC analítico': '4.3.2.10' }),
        pessoal(7, { Cargo: '  ' }),
        pessoal(8, { Cargo: 'x'.repeat(121) }),
        pessoal(9, { Quantidade: '0' }),
        pessoal(10, { Quantidade: '10000' }),
        pessoal(11, { Quantidade: '1.5' }),
        pessoal(12, { Quantidade: '2 pessoas' }),
        pessoal(13, { 'Salário mensal (R$)': '0' }),
        pessoal(14, { 'Salário mensal (R$)': '1000000' }),
        pessoal(15, { 'Salário mensal (R$)': '-100' }),
        pessoal(16, { 'Mês de saída (1–12)': '13' }),
        pessoal(17, { 'Mês de início (1–12)': '5', 'Mês de saída (1–12)': '4' }),
        pessoal(18, { 'Salário mensal (R$)': '7.500,00' }),
        pessoal(19, { Cargo: '=1+1' }),
      ],
    });
    expect(erros(r)).toEqual([
      'Pessoal:5:CC analítico:CC não é analítico ativo.',
      'Pessoal:6:CC analítico:CC fora do seu escopo.',
      'Pessoal:7:Cargo:Cargo obrigatório.',
      'Pessoal:8:Cargo:Cargo com mais de 120 caracteres.',
      'Pessoal:9:Quantidade:Quantidade inteira, de 1 a 9.999.',
      'Pessoal:10:Quantidade:Quantidade inteira, de 1 a 9.999.',
      'Pessoal:11:Quantidade:Quantidade inteira, de 1 a 9.999.',
      'Pessoal:12:Quantidade:Quantidade inteira, de 1 a 9.999.',
      'Pessoal:13:Salário mensal (R$):Salário maior que zero.',
      'Pessoal:14:Salário mensal (R$):Salário mensal precisa ser menor que R$ 1.000.000,00.',
      'Pessoal:15:Salário mensal (R$):Salário maior que zero.',
      'Pessoal:16:Mês de saída (1–12):Informe um mês de 1 a 12.',
      'Pessoal:17:Mês de início (1–12):Mês de início depois do mês de saída.',
      'Pessoal:18:Salário mensal (R$):Valor em formato inválido. Digite o número na célula, com até 2 casas decimais.',
      'Pessoal:19:Cargo:Texto não pode começar com =, + ou @.',
    ]);
  });
});

describe('validarPlanilha: Pacotes base zero', () => {
  it('linha válida; opções sem diferença de caixa e espaço; mês do mensal ignorado', () => {
    const r = validar({ pacotes: [pacote(5, { Prioridade: ' importante ', 'Corrigir pelo IPCA?': 'não', 'Mês (se pontual)': '3' })] });
    expect(r.ok && r.conteudo.pacotes).toEqual([
      {
        linha: 5, cc: '4.4', conta: '4.1.1.5.005', justificativa: 'Reposição anual de material de escritório', prioridade: 'IMPORTANTE',
        quantidade: 12, valorUnitario: Dinheiro.de('350'), corrigirIpca: false, distribuicao: 'MENSAL', mesOcorrencia: null,
      },
    ]);
  });

  it('pontual com mês; descrição começando com "-" é aceita', () => {
    const r = validar({ pacotes: [pacote(5, { Distribuição: 'Pontual', 'Mês (se pontual)': '7', 'Atividade / justificativa (mín. 10 caracteres)': '- reposição de toner' })] });
    expect(r.ok && r.conteudo.pacotes[0]).toMatchObject({ distribuicao: 'PONTUAL', mesOcorrencia: 7, justificativa: '- reposição de toner' });
  });

  it('erros por campo', () => {
    const J = 'Atividade / justificativa (mín. 10 caracteres)';
    const r = validar({
      pacotes: [
        pacote(5, { 'Conta analítica': '4.1.1.1.001' }),
        pacote(6, { [J]: '  curta  ' }),
        pacote(7, { [J]: 'x'.repeat(1001) }),
        pacote(8, { Prioridade: 'urgente' }),
        pacote(9, { 'Corrigir pelo IPCA?': null }),
        pacote(10, { Distribuição: 'Pontual', 'Mês (se pontual)': null }),
        pacote(11, { Distribuição: 'Pontual', 'Mês (se pontual)': '0' }),
        pacote(12, { Distribuição: 'Anual' }),
        pacote(13, { 'Valor unitário (R$)': '0' }),
        pacote(14, { [J]: '+cmd reposição' }),
      ],
    });
    expect(erros(r)).toEqual([
      'Pacotes base zero:5:Conta analítica:Conta não permitida em pacote base zero.',
      `Pacotes base zero:6:${J}:Justificativa com menos de 10 caracteres.`,
      `Pacotes base zero:7:${J}:Justificativa com mais de 1.000 caracteres.`,
      'Pacotes base zero:8:Prioridade:Prioridade obrigatória: Essencial, Importante ou Desejável.',
      'Pacotes base zero:9:Corrigir pelo IPCA?:Informe Sim ou Não em Corrigir pelo IPCA.',
      'Pacotes base zero:10:Mês (se pontual):Informe um mês de 1 a 12.',
      'Pacotes base zero:11:Mês (se pontual):Informe um mês de 1 a 12.',
      'Pacotes base zero:12:Distribuição:Distribuição obrigatória: Mensal ou Pontual.',
      'Pacotes base zero:13:Valor unitário (R$):Valor unitário maior que zero.',
      `Pacotes base zero:14:${J}:Texto não pode começar com =, + ou @.`,
    ]);
  });
});

describe('validarPlanilha: Receitas', () => {
  it('situação sem caixa; mês vazio → 0,00', () => {
    const r = validar({ receitas: [receita(5, { Situação: 'confirmado', Mar: null })] });
    expect(r.ok && r.conteudo.receitas[0]).toMatchObject({ tp: '001/2026', situacao: 'CONFIRMADO' });
    expect(r.ok && r.conteudo.receitas[0]!.meses.map((m) => m.paraString())[2]).toBe('0.00');
  });

  it('TP vazio, situação inválida, mês negativo e TP repetido nas duas linhas', () => {
    const r = validar({
      receitas: [receita(5, { 'TP / versão': ' ' }), receita(6, { Situação: 'Talvez' }), receita(7, { Fev: '-1' }), receita(8, { 'TP / versão': '002/2026' }), receita(9, { 'TP / versão': '002/2026' })],
    });
    expect(erros(r)).toEqual([
      'Receitas:5:TP / versão:TP / versão obrigatório.',
      'Receitas:6:Situação:Situação obrigatória: Confirmado ou Previsto.',
      'Receitas:7:Fev:Valor do mês não pode ser negativo.',
      'Receitas:8:TP / versão:TP / versão repetido nas linhas 8 e 9.',
      'Receitas:9:TP / versão:TP / versão repetido nas linhas 8 e 9.',
    ]);
  });

  it('validarReceita (reaproveitada pela tela da Task 5)', () => {
    const r = validarReceita(receita(1).celulas);
    expect(r.ok && r.valor.meses).toHaveLength(12);
    expect(validarReceita(receita(1, { Descrição: 'x'.repeat(201) }).celulas)).toEqual({
      ok: false,
      erros: [{ campo: 'Descrição', mensagem: 'Descrição com mais de 200 caracteres.' }],
    });
  });
});

describe('validarPlanilha: acúmulo', () => {
  it('erros de abas diferentes, ordenados por aba e linha', () => {
    const r = validar({ receitas: [receita(7, { Situação: null })], pessoal: [pessoal(9, { Cargo: null })], pacotes: [pacote(3, { Prioridade: null })] });
    expect(erros(r).map((e) => e.split(':').slice(0, 2).join(':'))).toEqual(['Pessoal:9', 'Pacotes base zero:3', 'Receitas:7']);
  });
});
