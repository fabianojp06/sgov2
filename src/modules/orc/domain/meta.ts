import { falha, ok, type Dinheiro, type ErroCampo, type Resultado } from '@/shared/kernel';
import { MENSAGENS_ORC as M } from './mensagens';
import type { CategoriaProposta } from './proposta';
import { contarCaracteres } from './texto';
import { lerValorDigitado } from './valor-tela';

// Meta da proposta de TP (US-067, UC03.15 e UC03.16; plano do P19, D-P19-3). Função pura: a versão, a
// proposta e a unicidade do número são conferidas no caso de uso. Os limites espelham os CHECKs da
// migration 202611131400_orc_meta.

export const STATUS_META = ['ATIVO', 'INATIVO'] as const;
export type StatusMeta = (typeof STATUS_META)[number];
export const ROTULO_STATUS_META: Readonly<Record<StatusMeta, string>> = { ATIVO: 'Ativo', INATIVO: 'Inativo' };

export const LIMITE_NUMERO_META = 20;
export const LIMITE_NOME_META = 200;
export const LIMITE_OBSERVACAO_META = 1000;

export type MetaValidada = {
  /** Só na inclusão: o número é imutável (UC03.16, passo 4). */
  numero: string;
  nome: string;
  valor: Dinheiro;
  status: StatusMeta;
  observacao: string | null;
};

export type ModoMeta = 'incluir' | 'alterar';

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');


/**
 * RN0139 e RN0106 (D-P19-3): número (só na inclusão), nome, valor e status obrigatórios; status ATIVO ou
 * INATIVO; valor ≥ 0,00 com até 2 casas. No modo alterar, o número não é lido (vem da meta gravada).
 */
export function validarMeta(bruto: Readonly<Record<string, unknown>>, modo: ModoMeta): Resultado<MetaValidada> {
  const obrigatorios = modo === 'incluir' ? (['numero', 'nome', 'valor', 'status'] as const) : (['nome', 'valor', 'status'] as const);
  const v = { numero: texto(bruto.numero), nome: texto(bruto.nome), valor: texto(bruto.valor), status: texto(bruto.status), observacao: texto(bruto.observacao) };
  const erros: ErroCampo[] = [];

  // E1 do UC03.15: a mensagem completa uma vez, e cada campo em branco marcado.
  const vazios = obrigatorios.filter((c) => v[c] === '');
  if (vazios.length > 0) erros.push({ campo: '_', mensagem: M.META_OBRIGATORIOS }, ...vazios.map((campo) => ({ campo, mensagem: M.PROPOSTA_CAMPO_OBRIGATORIO })));

  if (modo === 'incluir' && contarCaracteres(v.numero) > LIMITE_NUMERO_META) erros.push({ campo: 'numero', mensagem: M.META_NUMERO_LONGO(LIMITE_NUMERO_META) });
  if (contarCaracteres(v.nome) > LIMITE_NOME_META) erros.push({ campo: 'nome', mensagem: M.META_NOME_LONGO(LIMITE_NOME_META) });
  if (contarCaracteres(v.observacao) > LIMITE_OBSERVACAO_META) erros.push({ campo: 'observacao', mensagem: M.META_OBSERVACAO_LONGA(LIMITE_OBSERVACAO_META) });
  if (v.status !== '' && !(STATUS_META as readonly string[]).includes(v.status)) erros.push({ campo: 'status', mensagem: M.META_STATUS_INVALIDO });

  const valor = v.valor === '' ? null : lerValorDigitado(v.valor);
  if (v.valor !== '' && (valor === null || valor.ehNegativo())) erros.push({ campo: 'valor', mensagem: M.META_VALOR_INVALIDO });

  if (erros.length > 0) return falha(erros);
  return ok({ numero: v.numero, nome: v.nome, valor: valor!, status: v.status as StatusMeta, observacao: v.observacao === '' ? null : v.observacao });
}

/**
 * RN_VIA_04 (D-P19-7) [PROVISÓRIO até o GAP-VIA-001]: a despesa da proposta (viagem, headcount) aponta
 * para uma meta quando a proposta opera por metas. A Consolidada não tem metas (D-P19-2). As travas na
 * gravação são das US-070 e US-071.
 */
export const metaExigida = (categoria: CategoriaProposta): boolean => categoria === 'META';
