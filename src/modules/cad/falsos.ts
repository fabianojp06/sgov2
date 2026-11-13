import { Dinheiro, ErroDominio, ok, Percentual } from '@/shared/kernel';
import {
  validarPosicao,
  type LinhaComponente,
  type PosicaoPessoal,
  type PremissasExercicio,
} from './domain/custo-pessoal';
import {
  congelarArvore,
  montarIndice,
  prepararArvoreCentrosCusto,
  prepararArvoreContas,
  type NoCentroCusto,
  type NoConta,
} from './domain/estrutura';
import type {
  carregarIndiceEstrutura,
  ehCentroCustoAnalitico,
  ehContaAnaliticaAtiva,
  listarArvoreCentrosCusto,
  listarArvoreContas,
} from './infrastructure/estrutura-financeira';
import type {
  calcularCustoPosicao,
  congelarPremissasExercicio,
  garantirPremissasExercicio,
  obterPremissasExercicio,
} from './infrastructure/premissas';
import type { beneficiosDoCargo, beneficiosDosCargos, CargoExercicio, listarCargosSemSalarioCifrado } from './infrastructure/cargos-exercicio';
import type { impostosVigentes, ImpostoVigente } from './infrastructure/impostos';

// Adaptadores falsos dos contratos do cad, só para testes dos módulos consumidores (spec §12.6).

const conta = (classificacao: string, descricao: string, codigoReduzido: string | null, filhos: NoConta[] = []): NoConta => {
  const nivel = classificacao.split('.').length as NoConta['nivel'];
  return { classificacao, codigoReduzido, descricao, nivel, tipo: nivel === 5 ? 'ANALITICA' : 'SINTETICA', ativa: true, filhos };
};

/** Trecho real do plano de contas oficial de 5 níveis (spec §6.1). */
export const CONTAS_EXEMPLO: readonly NoConta[] = congelarArvore([
  conta('4', 'DESPESAS', null, [
    conta('4.1', 'DESPESAS OPERACIONAIS', null, [
      conta('4.1.1', 'DESPESAS DE SERVIÇOS', null, [
        conta('4.1.1.1', 'DESPESAS DE PESSOAL', null, [
          conta('4.1.1.1.001', 'Salários', '900'),
          conta('4.1.1.1.003', 'Férias', '920'),
          conta('4.1.1.1.005', '13 Salário', '940'),
        ]),
        conta('4.1.1.2', 'ENCARGOS SOCIAIS', null, [conta('4.1.1.2.001', 'INSS', '981')]),
        conta('4.1.1.5', 'DESPESAS ADMINISTRATIVAS', null, [conta('4.1.1.5.005', 'Material de escritório', '1270')]),
      ]),
    ]),
  ]),
]);

const cc = (
  classificacao: string,
  codigoReduzido: string,
  descricao: string,
  analitico: boolean,
  filhos: NoCentroCusto[] = [],
): NoCentroCusto => {
  const nivel = classificacao.split('.').length as NoCentroCusto['nivel'];
  // R17: analítico com sufixo .0 no nível 3 ou .10 no nível 4 é de gestão.
  const deGestao = analitico && ((nivel === 3 && classificacao.endsWith('.0')) || (nivel === 4 && classificacao.endsWith('.10')));
  return {
    classificacao,
    codigoReduzido,
    descricao,
    nivel,
    tipo: analitico ? 'ANALITICO' : 'SINTETICO',
    ativo: true,
    deGestao,
    natureza: null,
    provisorio: true,
    filhos,
  };
};

/** Trecho real da minuta do plano de centros de custo (Rev23102026), ainda sem aprovação da DIREX. */
export const CENTROS_CUSTO_EXEMPLO: readonly NoCentroCusto[] = congelarArvore([
  cc('4', '14.180', 'DIREX', false, [
    cc('4.3', '14.310', 'Diretoria Administrativa Financeira', false, [
      cc('4.3.0', '14.500', 'Gabinete da Diretoria Administrativa Financeira', true),
      cc('4.3.2', '14.360', 'Gerência Financeira', false, [
        cc('4.3.2.10', '14.520', 'Gestão da Gerência Financeira', true),
        cc('4.3.2.11', '14.370', 'Setor de Controle Orçamentário', true),
      ]),
    ]),
    cc('4.4', '14.450', 'Suporte Administrativo', true),
  ]),
]);

/**
 * Estrutura sintética de TPs (C37, GAP-CC-004), a mesma da seed de referência: raiz 9 fora da
 * estrutura 4. Separada do CENTROS_CUSTO_EXEMPLO para não mudar os testes que já o usam; junte as duas
 * (`[...CENTROS_CUSTO_EXEMPLO, ...CENTROS_CUSTO_TPS_EXEMPLO]`) quando precisar dos TPs.
 */
export const CENTROS_CUSTO_TPS_EXEMPLO: readonly NoCentroCusto[] = congelarArvore([
  cc('9', '90.000', 'Termos de Parceria (sintético)', false, [
    cc('9.1', '90.001', 'TP sintético 1', true),
    cc('9.2', '90.002', 'TP sintético 2', true),
    cc('9.3', '90.003', 'TP sintético 3', true),
  ]),
]);

/**
 * Falso do C1: mesma semântica dos reais (só ativos por padrão, filhos ordenados pela
 * classificação, analítico e ativo), sobre árvores em memória. Ignora a transação.
 */
export function estruturaFinanceiraFalsa(dados: { contas?: readonly NoConta[]; centrosCusto?: readonly NoCentroCusto[] } = {}): {
  listarArvoreContas: typeof listarArvoreContas;
  listarArvoreCentrosCusto: typeof listarArvoreCentrosCusto;
  ehContaAnaliticaAtiva: typeof ehContaAnaliticaAtiva;
  ehCentroCustoAnalitico: typeof ehCentroCustoAnalitico;
  carregarIndiceEstrutura: typeof carregarIndiceEstrutura;
} {
  const contas = dados.contas ?? CONTAS_EXEMPLO;
  const centrosCusto = dados.centrosCusto ?? CENTROS_CUSTO_EXEMPLO;
  const indice = montarIndice(contas, centrosCusto);
  return {
    listarArvoreContas: async (_tx, opcoes) => prepararArvoreContas(contas, opcoes),
    listarArvoreCentrosCusto: async (_tx, opcoes) => prepararArvoreCentrosCusto(centrosCusto, opcoes),
    ehContaAnaliticaAtiva: async (_tx, classificacao) => indice.contaAnaliticaAtiva(classificacao),
    ehCentroCustoAnalitico: async (_tx, classificacao) => indice.centroCustoAnalitico(classificacao),
    carregarIndiceEstrutura: async () => indice,
  };
}

const pct = (pontos: string) => Percentual.dePontos(pontos);

/**
 * Premissas de exemplo (R14): reajuste de 5% a partir de maio, encargos do C&S V4 somando 51 pontos
 * (38 + 8 + 1 + 3,8 + 0,2) e os benefícios VR 800,00, saúde 600,00 e vida 50,00 por pessoa/mês.
 * O IPCA e o salário mínimo são ilustrativos, só para testes; não são os padrões do seed (Task 9a).
 */
export function premissasExemplo(ano = 2027): PremissasExercicio {
  return {
    ano,
    versao: 1,
    congelado: false,
    provisorio: true,
    reajuste: pct('5'),
    mesDataBase: 5,
    ipca: pct('4.5'),
    salarioMinimo: Dinheiro.de('1518.00'),
    encargos: [
      { componente: 'encargo.inss', nome: 'INSS', percentual: pct('38'), conta: '4.1.1.2.001' },
      { componente: 'encargo.fgts', nome: 'FGTS', percentual: pct('8'), conta: '4.1.1.2.005' },
      { componente: 'encargo.pis', nome: 'PIS/PASEP', percentual: pct('1'), conta: '4.1.1.2.008' },
      { componente: 'encargo.obrigacoes', nome: 'Obrigações', percentual: pct('3.8'), conta: '4.1.1.8.003' },
      { componente: 'encargo.riscos', nome: 'Riscos', percentual: pct('0.2'), conta: '4.1.1.8.004' },
    ],
    contas: {
      salario: '4.1.1.1.001',
      adicional: '4.1.1.1.025',
      ferias: '4.1.1.1.003',
      decimo_terceiro: '4.1.1.1.005',
    },
    beneficios: [
      { componente: 'beneficio.vale_refeicao', nome: 'Vale-refeição', forma: 'VALOR_MENSAL', valorMensal: Dinheiro.de('800.00'), conta: '4.1.1.1.009' },
      { componente: 'beneficio.seguro_saude', nome: 'Seguro saúde', forma: 'VALOR_MENSAL', valorMensal: Dinheiro.de('600.00'), conta: '4.1.1.1.008' },
      { componente: 'beneficio.seguro_vida', nome: 'Seguro de vida', forma: 'VALOR_MENSAL', valorMensal: Dinheiro.de('50.00'), conta: '4.1.1.1.007' },
    ],
    avisos: [],
  };
}

/**
 * Falso do C2. NÃO reproduz a fórmula: põe tudo em 'salario' (quantidade × salário nos meses
 * ativos). Os testes consumidores conferem as chamadas e a gravação da série, nunca os valores;
 * os valores oficiais são provados na Task 11. Valida a posição como o real. Ignora a transação.
 */
/**
 * Cargos de exemplo do acréscimo de C&S ao C2: um com Fonte Ativa e faixa, um com periculosidade, um sem
 * Fonte Ativa (a posição não o usa) e um inativo (só com incluirInativos).
 */
export function cargosExemplo(): readonly CargoExercicio[] {
  return [
    {
      id: '00000000-0000-4000-8000-000000000001',
      codigo: 'C001',
      nome: 'Analista de orçamento',
      ativo: true,
      fonteAtiva: 'MINIMO',
      salarioFonteAtiva: Dinheiro.de('7500.00'),
      faixa: { minimo: Dinheiro.de('7500.00'), maximo: Dinheiro.de('9800.00') },
      adicional: null,
      vinculoFuncional: { id: '00000000-0000-4000-8000-0000000000f1', nome: 'Setor de Orçamento', tipo: 'SETOR' },
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      codigo: 'C002',
      nome: 'Técnico de manutenção',
      ativo: true,
      fonteAtiva: 'REAL',
      salarioFonteAtiva: Dinheiro.de('4200.00'),
      faixa: { minimo: Dinheiro.de('3800.00'), maximo: Dinheiro.de('4600.00') },
      adicional: { tipo: 'PERICULOSIDADE' },
      vinculoFuncional: null,
    },
    { id: '00000000-0000-4000-8000-000000000003', codigo: 'C003', nome: 'Assessor', ativo: true, fonteAtiva: null, salarioFonteAtiva: null, faixa: null, adicional: null, vinculoFuncional: null },
    {
      id: '00000000-0000-4000-8000-000000000004',
      codigo: 'C004',
      nome: 'Cargo extinto',
      ativo: false,
      fonteAtiva: 'MAXIMO',
      salarioFonteAtiva: Dinheiro.de('5000.00'),
      faixa: { minimo: Dinheiro.de('4000.00'), maximo: Dinheiro.de('5000.00') },
      adicional: null,
      vinculoFuncional: null,
    },
  ];
}

export function custoPessoalFalso(
  premissas: readonly PremissasExercicio[] = [premissasExemplo()],
  cargos: readonly CargoExercicio[] = cargosExemplo(),
  impostos: readonly ImpostoVigente[] = [],
): {
  calcularCustoPosicao: typeof calcularCustoPosicao;
  obterPremissasExercicio: typeof obterPremissasExercicio;
  garantirPremissasExercicio: typeof garantirPremissasExercicio;
  congelarPremissasExercicio: typeof congelarPremissasExercicio;
  listarCargosExercicio: typeof listarCargosSemSalarioCifrado;
  listarCargosSemSalarioCifrado: typeof listarCargosSemSalarioCifrado;
  beneficiosDoCargo: typeof beneficiosDoCargo;
  beneficiosDosCargos: typeof beneficiosDosCargos;
  impostosVigentes: typeof impostosVigentes;
  chamadas: { posicao: PosicaoPessoal; premissas: PremissasExercicio }[];
  congelados: ReadonlySet<number>;
} {
  const porAno = new Map(premissas.map((p) => [p.ano, p]));
  const chamadas: { posicao: PosicaoPessoal; premissas: PremissasExercicio }[] = [];
  const congelados = new Set<number>();
  const beneficiosFalsos = (ano: number, cargoId: string) => {
    const p = cargos.some((c) => c.id === cargoId) ? porAno.get(ano) : undefined;
    return p ? { beneficios: p.beneficios, avisos: p.avisos } : { beneficios: [], avisos: [] };
  };
  return {
    chamadas,
    congelados,
    calcularCustoPosicao: (posicao, p) => {
      chamadas.push({ posicao, premissas: p });
      const valida = validarPosicao(posicao, p);
      if (!valida.ok) return valida;
      const mensal = posicao.salarioMensal.multiplicar(String(posicao.quantidade));
      const meses = Array.from({ length: 12 }, (_, i) =>
        i + 1 >= posicao.mesInicio && i + 1 <= posicao.mesSaida ? mensal : Dinheiro.zero(),
      );
      const total = Dinheiro.somarTodos(meses);
      const linha: LinhaComponente = { componente: 'salario', conta: p.contas.salario, meses, total };
      return ok({ ano: p.ano, versaoPremissas: p.versao, linhas: [linha], totalMes: [...meses], total });
    },
    obterPremissasExercicio: async (_tx, ano) => porAno.get(ano) ?? null,
    garantirPremissasExercicio: async (_tx, _contexto, ano) => {
      const existente = porAno.get(ano);
      if (existente) return existente;
      const criadas = premissasExemplo(ano);
      porAno.set(ano, criadas);
      return criadas;
    },
    congelarPremissasExercicio: async (_tx, _contexto, ano) => {
      const atual = porAno.get(ano);
      if (!atual) throw new ErroDominio('cad.premissas_inexistentes', `O exercício ${ano} não tem parâmetros.`);
      congelados.add(ano);
      porAno.set(ano, { ...atual, congelado: true });
    },
    // O falso não distingue o app do worker: os dois devolvem os cargos como estão (com salário).
    listarCargosExercicio: async (_tx, opcoes = {}) => cargos.filter((c) => opcoes.incluirInativos || c.ativo),
    listarCargosSemSalarioCifrado: async (_tx, opcoes = {}) => cargos.filter((c) => opcoes.incluirInativos || c.ativo),
    // O falso não tem escolha por cargo: os benefícios e os avisos das premissas do ano, para um cargo conhecido.
    beneficiosDoCargo: async (_tx, ano, cargoId) => beneficiosFalsos(ano, cargoId),
    // Como o real: todo id pedido entra no mapa, o desconhecido com listas vazias.
    beneficiosDosCargos: async (_tx, ano, cargoIds) => new Map(cargoIds.map((id) => [id, beneficiosFalsos(ano, id)])),
    // O falso devolve a lista dada, filtrada pelo tipo como o real (a competência fica com quem montou a lista).
    impostosVigentes: async (_tx, _competencia, opcoes = {}) =>
      impostos.filter((i) => !opcoes.tipo || i.incidencia === 'AMBOS' || i.incidencia === opcoes.tipo),
  };
}
