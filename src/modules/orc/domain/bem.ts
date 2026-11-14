import { Dinheiro, falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { MENSAGENS_ORC as M } from './mensagens';
import { lerDataCivil } from './proposta';
import { contarCaracteres } from './texto';
import { lerValorDigitado } from './valor-tela';

// Bem, serviço ou equipamento (CAPEX) da proposta de TP (US-072; UC03.35 e UC03.36; plano do P22, D-P22-2,
// D-P22-5 e D-P22-7). Funções puras: a meta, a conta no plano e a inativação são conferidas no caso de uso.
// Os limites espelham os CHECKs da migration 202611140300_orc_bem.

export const LIMITE_DESCRICAO_BEM = 200;
export const QUANTIDADE_MAXIMA_BEM = 999_999;

export type BemValidado = { conta: string; descricao: string; data: Date; quantidade: number; valorUnitario: Dinheiro };

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const paraTela = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;

/** "AAAA-MM-DD", para o input date e o Histórico. */
export const dataParaTexto = (d: Date): string => d.toISOString().slice(0, 10);
/** "DD/MM/AAAA", para a tela. */
export const dataParaTela = paraTela;

/** RN0157: valor total = quantidade × valor unitário (exato: a quantidade é inteira). */
export const totalDoBem = (b: { quantidade: number; valorUnitario: Dinheiro }): Dinheiro => b.valorUnitario.multiplicar(String(b.quantidade));

/**
 * REQ0290, RN0418 e D-P22-5: conta, descrição, data, quantidade e valor unitário obrigatórios; descrição até
 * 200; quantidade inteira de 1 a 999.999; valor ≥ 0 com até duas casas; data dentro da vigência da capa.
 */
export function validarBem(bruto: Readonly<Record<string, unknown>>, vigencia: { inicio: Date; fim: Date }): Resultado<BemValidado> {
  const v = {
    conta: texto(bruto.conta),
    descricao: texto(bruto.descricao),
    data: texto(bruto.data),
    quantidade: texto(bruto.quantidade),
    valorUnitario: texto(bruto.valorUnitario),
  };
  const erros: ErroCampo[] = [];
  const vazios = (['conta', 'descricao', 'data', 'quantidade', 'valorUnitario'] as const).filter((c) => v[c] === '');
  if (vazios.length > 0) erros.push({ campo: '_', mensagem: M.BEM_OBRIGATORIOS }, ...vazios.map((campo) => ({ campo, mensagem: M.PROPOSTA_CAMPO_OBRIGATORIO })));
  if (contarCaracteres(v.descricao) > LIMITE_DESCRICAO_BEM) erros.push({ campo: 'descricao', mensagem: M.BEM_DESCRICAO_LONGA(LIMITE_DESCRICAO_BEM) });
  const quantidade = /^\d{1,6}$/.test(v.quantidade) ? Number(v.quantidade) : null;
  if (v.quantidade !== '' && (quantidade === null || quantidade < 1)) erros.push({ campo: 'quantidade', mensagem: M.BEM_QUANTIDADE_INVALIDA('999.999') });
  const valorUnitario = v.valorUnitario === '' ? null : lerValorDigitado(v.valorUnitario);
  if (v.valorUnitario !== '' && (!valorUnitario || valorUnitario.ehNegativo())) erros.push({ campo: 'valorUnitario', mensagem: M.VIAGEM_VALOR_INVALIDO });
  const data = v.data === '' ? null : lerDataCivil(v.data);
  if (v.data !== '' && !data) erros.push({ campo: 'data', mensagem: M.PROPOSTA_DATA_INVALIDA });
  if (data && (data < vigencia.inicio || data > vigencia.fim))
    erros.push({ campo: 'data', mensagem: M.BEM_DATA_FORA_DA_VIGENCIA(paraTela(vigencia.inicio), paraTela(vigencia.fim)) });
  if (erros.length > 0 || !data || quantidade === null || quantidade < 1 || !valorUnitario) return falha(erros);
  try {
    totalDoBem({ quantidade, valorUnitario });
  } catch {
    return falha([{ campo: '_', mensagem: M.BEM_CUSTO_FORA_DO_LIMITE }]); // o produto passa de NUMERIC(15,2)
  }
  return ok({ conta: v.conta, descricao: v.descricao, data, quantidade, valorUnitario });
}

export type GrupoConta<T> = { conta: string; itens: readonly T[]; subtotal: Dinheiro };

/**
 * RF_PAT_REQ_001, RN0415, RN0417 e RN0383 (D-P22-7): um grupo por conta, em ordem crescente da classificação
 * (por segmentos), com o subtotal. Sem os zerados, somem o item de total zero e a conta de subtotal zero; o
 * total geral não muda (Review Focus 3).
 */
export function agruparPorConta<T extends { conta: string; quantidade: number; valorUnitario: Dinheiro }>(
  bens: readonly T[],
  exibirZerados: boolean,
): { grupos: readonly GrupoConta<T>[]; total: Dinheiro } {
  const porConta = new Map<string, T[]>();
  for (const b of bens) {
    if (!exibirZerados && totalDoBem(b).ehZero()) continue;
    porConta.set(b.conta, [...(porConta.get(b.conta) ?? []), b]);
  }
  const grupos = [...porConta.entries()]
    .map(([conta, itens]) => ({ conta, itens, subtotal: Dinheiro.somarTodos(itens.map(totalDoBem)) }))
    .filter((g) => exibirZerados || !g.subtotal.ehZero())
    .sort((a, b) => a.conta.localeCompare(b.conta, 'pt-BR', { numeric: true }));
  return { grupos, total: Dinheiro.somarTodos(grupos.map((g) => g.subtotal)) };
}
