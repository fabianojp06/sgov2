import {
  Dinheiro,
  falha,
  ok,
  type ErroCampo,
  type Resultado,
} from "@/shared/kernel";
import { MENSAGENS_ORC as M } from "./mensagens";
import { contarCaracteres } from "./texto";
import { lerValorDigitado } from "./valor-tela";

// Viagem e teto de viagens da proposta de TP (US-071; Viagens V3 e UC03.29 a UC03.33; plano do P21, D-P21-2
// a D-P21-5 e D-P21-11). Funções puras: a meta, as contas no plano e a barreira do teto são conferidas no
// caso de uso. Os limites espelham os CHECKs da migration 202611140100_orc_viagem.

export const LIMITE_LOCALIDADE = 100;
export const MAXIMO_PESSOAS_DIAS = 9999;

export type DadosCustoViagem = {
  pessoas: number;
  dias: number;
  valorPassagem: Dinheiro;
  valorDiaria: Dinheiro;
  valorTransporte: Dinheiro;
};

export type ViagemValidada = DadosCustoViagem & {
  localidade: string;
  contaPassagem: string;
  contaDiaria: string;
  /** Obrigatória só com custo de transporte (D-P21-4). */
  contaTransporte: string | null;
};

export type CustoViagem = {
  passagem: Dinheiro;
  diaria: Dinheiro;
  transporte: Dinheiro;
  estimado: Dinheiro;
};

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * RN_VIA_03 e C19 (D-P21-3): custo estimado = pessoas × passagem + pessoas × dias × diária. O transporte
 * (pessoas × valor, [PROVISÓRIO]) fica fora do estimado e vai ao painel (REQ_VIA_005). Exato: os fatores
 * são inteiros e os valores têm duas casas.
 */
export function custoDaViagem(v: DadosCustoViagem): CustoViagem {
  const passagem = v.valorPassagem.multiplicar(String(v.pessoas));
  const diaria = v.valorDiaria.multiplicar(String(v.pessoas * v.dias));
  return {
    passagem,
    diaria,
    transporte: v.valorTransporte.multiplicar(String(v.pessoas)),
    estimado: passagem.somar(diaria),
  };
}

function lerInteiro(v: string): number | null {
  if (!/^\d{1,4}$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= MAXIMO_PESSOAS_DIAS ? n : null;
}

function lerValor(
  campo: string,
  v: string,
  erros: ErroCampo[],
): Dinheiro | null {
  if (v === "") return null;
  const valor = lerValorDigitado(v);
  if (!valor || valor.ehNegativo()) {
    erros.push({ campo, mensagem: M.VIAGEM_VALOR_INVALIDO });
    return null;
  }
  return valor;
}

/**
 * Viagens V3 (E4, RN_VIA_06) e D-P21-4: localidade, pessoas, dias, passagem, diária e as contas de
 * passagem e de diária obrigatórios; transporte vazio é zero e, se maior que zero, exige a conta de
 * transporte. As contas são só lidas aqui: se são analíticas ativas, o caso de uso confere no plano.
 */
export function validarViagem(
  bruto: Readonly<Record<string, unknown>>,
): Resultado<ViagemValidada> {
  const v = {
    localidade: texto(bruto.localidade),
    pessoas: texto(bruto.pessoas),
    dias: texto(bruto.dias),
    valorPassagem: texto(bruto.valorPassagem),
    valorDiaria: texto(bruto.valorDiaria),
    valorTransporte: texto(bruto.valorTransporte),
    contaPassagem: texto(bruto.contaPassagem),
    contaDiaria: texto(bruto.contaDiaria),
    contaTransporte: texto(bruto.contaTransporte),
  };
  const erros: ErroCampo[] = [];
  const obrigatorios = [
    "localidade",
    "pessoas",
    "dias",
    "valorPassagem",
    "valorDiaria",
    "contaPassagem",
    "contaDiaria",
  ] as const;
  const vazios = obrigatorios.filter((c) => v[c] === "");
  if (vazios.length > 0)
    erros.push(
      { campo: "_", mensagem: M.VIAGEM_OBRIGATORIOS },
      ...vazios.map((campo) => ({
        campo,
        mensagem: M.PROPOSTA_CAMPO_OBRIGATORIO,
      })),
    );
  if (contarCaracteres(v.localidade) > LIMITE_LOCALIDADE)
    erros.push({
      campo: "localidade",
      mensagem: M.VIAGEM_LOCALIDADE_LONGA(LIMITE_LOCALIDADE),
    });
  const pessoas = v.pessoas === "" ? null : lerInteiro(v.pessoas);
  if (v.pessoas !== "" && pessoas === null)
    erros.push({
      campo: "pessoas",
      mensagem: M.VIAGEM_INTEIRO_INVALIDO(MAXIMO_PESSOAS_DIAS),
    });
  const dias = v.dias === "" ? null : lerInteiro(v.dias);
  if (v.dias !== "" && dias === null)
    erros.push({
      campo: "dias",
      mensagem: M.VIAGEM_INTEIRO_INVALIDO(MAXIMO_PESSOAS_DIAS),
    });
  const valorPassagem = lerValor("valorPassagem", v.valorPassagem, erros);
  const valorDiaria = lerValor("valorDiaria", v.valorDiaria, erros);
  const valorTransporte =
    v.valorTransporte === ""
      ? Dinheiro.zero()
      : lerValor("valorTransporte", v.valorTransporte, erros);
  if (valorTransporte && !valorTransporte.ehZero() && v.contaTransporte === "")
    erros.push({
      campo: "contaTransporte",
      mensagem: M.VIAGEM_CONTA_TRANSPORTE_OBRIGATORIA,
    });
  if (
    erros.length > 0 ||
    pessoas === null ||
    dias === null ||
    !valorPassagem ||
    !valorDiaria ||
    !valorTransporte
  )
    return falha(erros);

  const dados = { pessoas, dias, valorPassagem, valorDiaria, valorTransporte };
  try {
    custoDaViagem(dados);
  } catch {
    return falha([{ campo: "_", mensagem: M.VIAGEM_CUSTO_FORA_DO_LIMITE }]); // o produto passa de NUMERIC(15,2)
  }
  return ok({
    ...dados,
    localidade: v.localidade,
    contaPassagem: v.contaPassagem,
    contaDiaria: v.contaDiaria,
    contaTransporte: v.contaTransporte === "" ? null : v.contaTransporte,
  });
}

/** C6 e E5 (D-P21-5): conta sintética e teto obrigatórios; teto maior que zero, com até duas casas. */
export function validarTeto(
  bruto: Readonly<Record<string, unknown>>,
  comConta: boolean,
): Resultado<{ contaSintetica: string; valor: Dinheiro }> {
  const v = {
    contaSintetica: texto(bruto.contaSintetica),
    valor: texto(bruto.valor),
  };
  const erros: ErroCampo[] = [];
  const vazios = (
    comConta ? (["contaSintetica", "valor"] as const) : (["valor"] as const)
  ).filter((c) => v[c] === "");
  if (vazios.length > 0)
    erros.push(
      { campo: "_", mensagem: M.TETO_OBRIGATORIOS },
      ...vazios.map((campo) => ({
        campo,
        mensagem: M.PROPOSTA_CAMPO_OBRIGATORIO,
      })),
    );
  const valor = v.valor === "" ? null : lerValorDigitado(v.valor);
  if (v.valor !== "" && (!valor || valor.ehNegativo()))
    erros.push({ campo: "valor", mensagem: M.VIAGEM_VALOR_INVALIDO });
  else if (valor?.ehZero())
    erros.push({ campo: "valor", mensagem: M.TETO_SEM_SALDO });
  if (erros.length > 0 || !valor) return falha(erros);
  return ok({ contaSintetica: v.contaSintetica, valor });
}

/** A conta está na subárvore da sintética (a classificação é por segmentos, R5). */
export const contaSob = (sintetica: string, conta: string): boolean =>
  conta === sintetica || conta.startsWith(`${sintetica}.`);

/** D-P21-5: duas sintéticas da mesma ramificação (uma é ancestral da outra, ou são a mesma). */
export const sinteticasAninhadas = (a: string, b: string): boolean =>
  contaSob(a, b) || contaSob(b, a);

export type IndicadoresViagens = {
  quantidade: number;
  custoTotal: Dinheiro;
  /** Nulo sem viagens (a divisão por zero não tem valor). */
  custoMedio: Dinheiro | null;
  pessoas: number;
  passagens: Dinheiro;
  diarias: Dinheiro;
  transportes: Dinheiro;
  /** Passagens + diárias + transporte (REQ_VIA_005) [PROVISÓRIO]. */
  totalGeral: Dinheiro;
  /** Custo estimado por localidade, do maior para o menor (REQ_VIA_006). */
  ranking: readonly { localidade: string; custo: Dinheiro }[];
};

/** RN_VIA_08 e REQ_VIA_004 a 006 (D-P21-11): os cartões, a composição e o ranking do painel. */
export function indicadores(
  viagens: readonly (DadosCustoViagem & { localidade: string })[],
): IndicadoresViagens {
  const custos = viagens.map((v) => custoDaViagem(v));
  const custoTotal = Dinheiro.somarTodos(custos.map((c) => c.estimado));
  const passagens = Dinheiro.somarTodos(custos.map((c) => c.passagem));
  const diarias = Dinheiro.somarTodos(custos.map((c) => c.diaria));
  const transportes = Dinheiro.somarTodos(custos.map((c) => c.transporte));
  // A mesma localidade com grafias de caixa diferentes ("Brasil" e "BRASIL") é uma barra só, com o nome da primeira.
  const porLocal = new Map<string, { localidade: string; custo: Dinheiro }>();
  viagens.forEach((v, i) => {
    const chave = v.localidade.toLocaleUpperCase("pt-BR");
    const atual = porLocal.get(chave);
    porLocal.set(chave, {
      localidade: atual?.localidade ?? v.localidade,
      custo: (atual?.custo ?? Dinheiro.zero()).somar(custos[i]!.estimado),
    });
  });
  const ranking = [...porLocal.values()].sort(
    (a, b) =>
      b.custo.comparar(a.custo) ||
      a.localidade.localeCompare(b.localidade, "pt-BR"),
  );
  return {
    quantidade: viagens.length,
    custoTotal,
    custoMedio:
      viagens.length === 0 ? null : custoTotal.dividir(String(viagens.length)),
    pessoas: viagens.reduce((s, v) => s + v.pessoas, 0),
    passagens,
    diarias,
    transportes,
    totalGeral: Dinheiro.somarTodos([passagens, diarias, transportes]),
    ranking,
  };
}
