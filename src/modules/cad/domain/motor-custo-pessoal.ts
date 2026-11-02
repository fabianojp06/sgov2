import { Dinheiro, falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import {
  COMPONENTES_FIXOS,
  validarPosicao,
  type CodigoComponente,
  type ComponenteEncargo,
  type LinhaComponente,
  type PosicaoPessoal,
  type PremissasExercicio,
  type SerieMensalComponentes,
} from './custo-pessoal';

// MotorCustoPessoal (US-051; plano do P4, Task 11; C2 real). Função pura, só Dinheiro e Percentual,
// na ordem de operações e com os arredondamentos da R14 (um Half-Even por componente). Mês 1 = janeiro.

const GRAU_INSALUBRIDADE = { MINIMO: '0.10', MEDIO: '0.20', MAXIMO: '0.40' } as const; // RN_CAR_11
const PERICULOSIDADE = '0.30'; // RN_CAR_10

/**
 * Encargo (RN_CAR_17, REQ_CAR_013; R13): o total é base × soma dos percentuais, com um único
 * Half-Even. Cada componente é arredondado em separado, e a diferença de centavo vai para o INSS
 * (ou, sem INSS, para o de maior percentual), como o distribuirEm12 faz com dezembro.
 */
export function calcularEncargo(
  base: Dinheiro,
  encargos: PremissasExercicio['encargos'],
): { total: Dinheiro; componentes: readonly { componente: ComponenteEncargo; valor: Dinheiro }[] } {
  if (encargos.length === 0) return { total: Dinheiro.zero(), componentes: [] };
  const soma = encargos.reduce((t, e) => t.plus(e.percentual.comoFracao()), encargos[0]!.percentual.comoFracao().times(0));
  const total = base.multiplicar(soma);
  const componentes = encargos.map((e) => ({ componente: e.componente, valor: base.multiplicar(e.percentual.comoFracao()) }));
  const resto = total.subtrair(Dinheiro.somarTodos(componentes.map((c) => c.valor)));
  if (!resto.ehZero()) {
    const alvo =
      componentes.findIndex((c) => c.componente === 'encargo.inss') >= 0
        ? componentes.findIndex((c) => c.componente === 'encargo.inss')
        : encargos.reduce((m, e, i) => (e.percentual.comoFracao().gt(encargos[m]!.percentual.comoFracao()) ? i : m), 0);
    componentes[alvo] = { ...componentes[alvo]!, valor: componentes[alvo]!.valor.somar(resto) };
  }
  return { total, componentes };
}

/** Toda conta usada pelo cálculo precisa existir (a recarga pode ter inativado uma; R14). */
function contasFaltando(premissas: PremissasExercicio, posicao: PosicaoPessoal): ErroCampo[] {
  const erros: ErroCampo[] = [];
  const contas = premissas.contas;
  for (const c of ['salario', 'ferias', 'decimo_terceiro'] as const) {
    if (!contas[c]) erros.push({ campo: `premissas.contas.${c}`, mensagem: `O componente ${c} está sem conta analítica ativa nos parâmetros do exercício.` });
  }
  if (posicao.adicional && !contas.adicional) {
    erros.push({ campo: 'premissas.contas.adicional', mensagem: 'O adicional está sem conta analítica ativa nos parâmetros do exercício.' });
  }
  for (const e of premissas.encargos) {
    if (!e.conta) erros.push({ campo: `premissas.${e.componente}`, mensagem: `O ${e.nome} está sem conta analítica ativa nos parâmetros do exercício.` });
  }
  for (const b of premissas.beneficios) {
    if (!b.conta) erros.push({ campo: `premissas.${b.componente}`, mensagem: `O benefício ${b.nome} está sem conta analítica ativa.` });
  }
  return erros;
}

/**
 * Custo mês a mês da posição, por componente e conta (R14). Posição ou premissas inválidas voltam
 * como erro por campo (R3), nunca como exceção. Só os componentes com algum mês diferente de zero
 * entram em `linhas`; a soma das linhas fecha com o totalMes, e a dos meses com o total (sem drift).
 */
export function calcularCustoPosicao(posicao: PosicaoPessoal, premissas: PremissasExercicio): Resultado<SerieMensalComponentes> {
  const valida = validarPosicao(posicao, premissas);
  if (!valida.ok) return valida;
  const semConta = contasFaltando(premissas, posicao);
  if (semConta.length > 0) return falha(semConta);

  const zero = Dinheiro.zero();
  const meses = new Map<CodigoComponente, Dinheiro[]>();
  const contaDe = new Map<CodigoComponente, string>();
  const somar = (c: CodigoComponente, conta: string, mes: number, v: Dinheiro) => {
    const serie = meses.get(c) ?? Array.from({ length: 12 }, () => zero);
    serie[mes - 1] = serie[mes - 1]!.somar(v);
    meses.set(c, serie);
    contaDe.set(c, conta);
  };
  const fatorReajuste = premissas.reajuste.comoFracao().plus(1);
  const qtd = String(posicao.quantidade);

  for (let m = posicao.mesInicio; m <= posicao.mesSaida; m++) {
    // 1. Salário: a primeira multiplicação é exata (inteiro × 2 casas); a do reajuste arredonda uma vez.
    const bruto = posicao.salarioMensal.multiplicar(qtd);
    const salario = m >= premissas.mesDataBase ? bruto.multiplicar(fatorReajuste) : bruto;
    // 2. Adicional.
    let adicional = zero;
    if (posicao.adicional?.tipo === 'PERICULOSIDADE') adicional = salario.multiplicar(PERICULOSIDADE);
    else if (posicao.adicional?.tipo === 'INSALUBRIDADE') {
      adicional = premissas.salarioMinimo!.multiplicar(qtd).multiplicar(GRAU_INSALUBRIDADE[posicao.adicional.grau]);
    }
    // 3 a 6. Base, férias + 1/3 (4/36), 13º (1/12) e encargo sobre os três.
    const base = salario.somar(adicional);
    const ferias = base.multiplicar('4').dividir('36');
    const decimo = base.dividir('12');
    const encargo = calcularEncargo(base.somar(ferias).somar(decimo), premissas.encargos);

    somar('salario', premissas.contas.salario, m, salario);
    if (!adicional.ehZero()) somar('adicional', premissas.contas.adicional, m, adicional);
    somar('ferias', premissas.contas.ferias, m, ferias);
    somar('decimo_terceiro', premissas.contas.decimo_terceiro, m, decimo);
    for (const c of encargo.componentes) somar(c.componente, premissas.encargos.find((e) => e.componente === c.componente)!.conta, m, c.valor);
    // 7. Benefícios: valor mensal × quantidade (exato) ou % do salário do mês (R14a, um arredondamento).
    for (const b of premissas.beneficios) {
      const v = b.forma === 'VALOR_MENSAL' ? b.valorMensal.multiplicar(qtd) : salario.multiplicar(b.percentual.comoFracao());
      somar(b.componente, b.conta, m, v);
    }
  }

  const ordem: CodigoComponente[] = [...COMPONENTES_FIXOS, ...premissas.beneficios.map((b) => b.componente)];
  const linhas: LinhaComponente[] = [];
  for (const c of ordem) {
    const serie = meses.get(c);
    if (!serie || serie.every((v) => v.ehZero())) continue;
    linhas.push(Object.freeze({ componente: c, conta: contaDe.get(c)!, meses: Object.freeze([...serie]), total: Dinheiro.somarTodos(serie) }));
  }
  const totalMes = Array.from({ length: 12 }, (_, i) => Dinheiro.somarTodos(linhas.map((l) => l.meses[i]!)));
  return ok(
    Object.freeze({ ano: premissas.ano, versaoPremissas: premissas.versao, linhas: Object.freeze(linhas), totalMes: Object.freeze(totalMes), total: Dinheiro.somarTodos(totalMes) }),
  );
}
