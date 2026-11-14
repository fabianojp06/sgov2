import Decimal from 'decimal.js';
import { Dinheiro, falha, ok, Percentual, type ErroCampo, type Resultado } from '@/shared/kernel';
import { competenciaParaTexto } from './empregado';
import { MENSAGENS_ORC as M } from './mensagens';
import type { TipoProposta } from './proposta';
import { lerValorDigitado, valorParaTela } from './valor-tela';

// Grade de Rateio/ISS da proposta de TP (US-073; UC03.03; plano do P24, D-P24-2 a D-P24-7). Funções puras: a
// base (orçado da sintética mandante), as contas no plano e a gravação ficam no caso de uso. Os limites
// espelham os CHECKs da migration 202611140500_orc_rateio.

export const MODOS_RATEIO = ['PERCENTUAL', 'VALOR'] as const;
export type ModoRateio = (typeof MODOS_RATEIO)[number];
export const ROTULO_MODO_RATEIO: Readonly<Record<ModoRateio, string>> = { PERCENTUAL: 'Percentual da base (%)', VALOR: 'Valor nominal (R$)' };
export const MAXIMO_LINHAS_RATEIO = 20;
export const ISS_MINIMO = '2';
export const ISS_MAXIMO = '5';

const PERCENTUAL_TEXTO = /^\d{1,3}([.,]\d{1,4})?$/;
const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** As competências da vigência, "AAAA-MM", em ordem (REQ_RAT_001). */
export function competenciasDaVigencia(inicio: Date, fim: Date): string[] {
  const r: string[] = [];
  for (let d = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth(), 1)); d <= fim; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    r.push(competenciaParaTexto(d));
  }
  return r;
}

/** "1,5" ou "1.5" (até 4 casas, de 0 a 999); nulo fora do formato. */
export function lerPercentual(v: string): Percentual | null {
  return PERCENTUAL_TEXTO.test(v) ? Percentual.dePontos(v.replace(',', '.')) : null;
}

/** % da base em R$, Half-Even (D-P24-3). */
export const valorDoPercentual = (base: Dinheiro, p: Percentual): Dinheiro => base.multiplicar(p.comoFracao());

/** R$ em % da base, com 4 casas Half-Even; base zero dá zero (D-P24-3). */
export const percentualDoValor = (base: Dinheiro, v: Dinheiro): Percentual =>
  base.ehZero() ? Percentual.dePontos('0') : Percentual.dePontos(new Decimal(v.paraString()).dividedBy(base.paraString()).times(100));

/**
 * REQ_RAT_002 (D-P24-3): o texto digitado num modo, convertido para o outro pela base. Texto fora do formato
 * fica como está, para a validação recusar com a mensagem certa.
 */
export function converterTexto(t: string, de: ModoRateio, para: ModoRateio, base: Dinheiro): string {
  if (de === para || t.trim() === '') return t;
  if (de === 'PERCENTUAL') {
    const p = lerPercentual(t.trim());
    return p ? valorParaTela(valorDoPercentual(base, p)) : t;
  }
  const v = lerValorDigitado(t.trim());
  return v ? percentualDoValor(base, v).paraString().replace('.', ',') : t;
}

export type CelulaRateio = { conta: string; competencia: string; valor: Dinheiro; percentual: Percentual | null };
export type GradeValidada = { contaSintetica: string; modo: ModoRateio; aliquotaIss: Percentual | null; celulas: readonly CelulaRateio[]; total: Dinheiro };

/** `baseVisivel` falso: quem não vê o pessoal não lê a base nem na mensagem do E1 (D-P24-2, revisão 12.12). */
export type ContextoGrade = { competencias: readonly string[]; base: Dinheiro; tipoProposta: TipoProposta; baseVisivel?: boolean };

/** Os nomes dos campos do formulário: a conta da linha i e a célula (linha i, competência). */
export const campoConta = (i: number) => `conta_${i}`;
export const campoCelula = (i: number, competencia: string) => `c_${i}_${competencia}`;

/** E2 (D-P24-7): no Contrato, a alíquota é obrigatória e fica entre 2,00% e 5,00%; o TP é imune (sem alíquota). */
function validarIss(t: string, tipo: TipoProposta, erros: ErroCampo[]): Percentual | null {
  if (tipo !== 'CONTRATO') return null;
  const p = t === '' ? null : lerPercentual(t);
  if (!p || p.comoFracao().times(100).lt(ISS_MINIMO) || p.comoFracao().times(100).gt(ISS_MAXIMO)) {
    erros.push({ campo: 'aliquotaIss', mensagem: M.RATEIO_ISS_FORA_DO_LIMITE });
    return null;
  }
  return p;
}

/**
 * RN_RAT_01, RN_RAT_03, RN_RAT_06, E1 e E2 (D-P24-2 a D-P24-7): sintética e modo obrigatórios; até 20 linhas, sem
 * conta repetida; cada célula ≥ 0 no modo (% até 4 casas, de 0 a 100; R$ com 2 casas); vazia é zero e não é
 * gravada; a soma de todas as células não passa da base. As contas no plano são conferidas no caso de uso.
 */
export function validarGrade(bruto: Readonly<Record<string, unknown>>, c: ContextoGrade): Resultado<GradeValidada> {
  const contaSintetica = texto(bruto.contaSintetica);
  const modo = texto(bruto.modo);
  const erros: ErroCampo[] = [];
  if (contaSintetica === '') erros.push({ campo: 'contaSintetica', mensagem: M.RATEIO_SINTETICA_OBRIGATORIA });
  if (!(MODOS_RATEIO as readonly string[]).includes(modo)) erros.push({ campo: 'modo', mensagem: M.RATEIO_MODO_INVALIDO });
  const aliquotaIss = validarIss(texto(bruto.aliquotaIss), c.tipoProposta, erros);
  if (erros.length > 0) return falha(erros);

  const celulas: CelulaRateio[] = [];
  const vistas = new Set<string>();
  let linhas = 0;
  for (let i = 0; i < MAXIMO_LINHAS_RATEIO + 5; i++) {
    const conta = texto(bruto[campoConta(i)]);
    const valores = c.competencias.map((comp) => [comp, texto(bruto[campoCelula(i, comp)])] as const);
    if (conta === '') {
      if (valores.some(([, v]) => v !== '' && v !== '0')) erros.push({ campo: campoConta(i), mensagem: M.RATEIO_LINHA_SEM_CONTA });
      continue;
    }
    if (++linhas > MAXIMO_LINHAS_RATEIO) {
      erros.push({ campo: '_', mensagem: M.RATEIO_LINHAS_DEMAIS(MAXIMO_LINHAS_RATEIO) });
      break;
    }
    if (vistas.has(conta)) erros.push({ campo: campoConta(i), mensagem: M.RATEIO_CONTA_REPETIDA(conta) });
    vistas.add(conta);
    for (const [competencia, v] of valores) {
      if (v === '') continue;
      if (modo === 'PERCENTUAL') {
        const p = lerPercentual(v);
        if (!p || p.comoFracao().gt(1)) erros.push({ campo: campoCelula(i, competencia), mensagem: M.RATEIO_PERCENTUAL_INVALIDO });
        else {
          // Um % tão pequeno que o valor arredonda a zero é recusado: sumiria sem aviso (revisão 12.12).
          const valor = valorDoPercentual(c.base, p);
          if (!valor.ehZero()) celulas.push({ conta, competencia, percentual: p, valor });
          else if (!p.comoFracao().isZero()) erros.push({ campo: campoCelula(i, competencia), mensagem: M.RATEIO_PERCENTUAL_PEQUENO });
        }
      } else {
        const d = lerValorDigitado(v);
        if (!d || d.ehNegativo()) erros.push({ campo: campoCelula(i, competencia), mensagem: M.VIAGEM_VALOR_INVALIDO });
        else if (!d.ehZero()) celulas.push({ conta, competencia, percentual: null, valor: d });
      }
    }
  }
  if (erros.length > 0) return falha(erros);
  const total = Dinheiro.somarTodos(celulas.map((x) => x.valor));
  if (total.comparar(c.base) > 0) {
    const mensagem = c.baseVisivel === false ? M.RATEIO_ESTOURO_RESTRITO(total.formatar()) : M.RATEIO_ESTOURO(total.formatar(), c.base.formatar());
    return falha([{ campo: '_', mensagem }]);
  }
  return ok({ contaSintetica, modo: modo as ModoRateio, aliquotaIss, celulas, total });
}

/**
 * RN_RAT_03 e C1 da #95 (D-P24-5): o valor da primeira célula diferente de zero vai para as células zeradas
 * seguintes da linha; as anteriores e as já preenchidas ficam como estão.
 */
export function replicarLinha<T>(valores: readonly (T | null)[]): (T | null)[] {
  const k = valores.findIndex((v) => v !== null);
  if (k < 0) return [...valores];
  return valores.map((v, j) => (j > k && v === null ? valores[k]! : v));
}
