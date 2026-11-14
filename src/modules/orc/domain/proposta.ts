import { falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { MENSAGENS_ORC as M } from './mensagens';
import { contarCaracteres } from './texto';

// Capa da proposta de TP (US-065; plano do P17, D-P17-2 a D-P17-7). Função pura: o CC é conferido no
// caso de uso, contra o C1. Os limites espelham os CHECKs da migration 202611122100_orc_proposta.

/** Raiz dos CCs de TP no plano de centros de custo (C37) [PROVISÓRIO] até a DIREX/GFIN fixarem na minuta. */
export const RAIZ_CC_TP = '9';
export const TIPOS_PROPOSTA = ['CONTRATO', 'TERMO_PARCERIA'] as const;
export const CATEGORIAS_PROPOSTA = ['CONSOLIDADA', 'META'] as const;
/** Ciclo de vida da versão (§6.2). A proposta nasce em Rascunho (RN_PROP_002, D-P17-6). */
export const SITUACOES_PROPOSTA = ['RASCUNHO', 'EM_ELABORACAO', 'EM_APROVACAO', 'OFICIALIZADO', 'ENCERRADO'] as const;

/**
 * De onde se cria nova versão (UC03.09; plano do P18, D-P18-1) [PROVISÓRIO até o UC03.09 ser reescrito, C16]:
 * só da última versão, e só nestas situações. O Oficializado muda por Termo Aditivo (§6.2, F4).
 */
export const SITUACOES_VERSIONAVEIS = ['RASCUNHO', 'EM_ELABORACAO'] as const satisfies readonly SituacaoProposta[];

export type TipoProposta = (typeof TIPOS_PROPOSTA)[number];
export type CategoriaProposta = (typeof CATEGORIAS_PROPOSTA)[number];
export type SituacaoProposta = (typeof SITUACOES_PROPOSTA)[number];

export const ROTULO_TIPO_PROPOSTA: Readonly<Record<TipoProposta, string>> = { CONTRATO: 'Contrato', TERMO_PARCERIA: 'Termo de Parceria' };
export const ROTULO_CATEGORIA_PROPOSTA: Readonly<Record<CategoriaProposta, string>> = { CONSOLIDADA: 'Consolidada', META: 'Meta' };
export const ROTULO_SITUACAO_PROPOSTA: Readonly<Record<SituacaoProposta, string>> = {
  RASCUNHO: 'Rascunho',
  EM_ELABORACAO: 'Em Elaboração',
  EM_APROVACAO: 'Em Aprovação',
  OFICIALIZADO: 'Oficializado',
  ENCERRADO: 'Encerrado',
};

/** RN_TP_002: término pelo menos 30 dias civis depois do início (D-P17-5). */
export const VIGENCIA_MINIMA_DIAS = 30;
export const LIMITE_NUMERO_TP = 60;
export const LIMITE_OBJETO = 500;
export const LIMITE_PARCEIRO = 200;
export const LIMITE_NOME_UNIDADE = 120;

export type CapaValidada = {
  tipo: TipoProposta;
  /** Número do TP: o código da unidade (D-P17-2), único e imutável. */
  numero: string;
  objeto: string;
  parceiro: string | null;
  /** Datas civis em AAAA-MM-DD. */
  inicio: string;
  fim: string;
  categoria: CategoriaProposta;
  /** Classificação do CC próprio do TP (C37). */
  cc: string;
};

const OBRIGATORIOS = ['tipo', 'numero', 'objeto', 'inicio', 'fim', 'categoria', 'cc'] as const;
const DIA_MS = 86_400_000;

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const pertence = <T extends string>(lista: readonly T[], v: string): v is T => (lista as readonly string[]).includes(v);

/** Dias desde a época de uma data civil AAAA-MM-DD; null se fora do formato ou inexistente (30/02). */
function diaCivil(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(ano, mes - 1, dia);
  const d = new Date(ms);
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return ms / DIA_MS;
}

/** "AAAA-MM-DD" (o input date) em UTC; nulo fora do formato ou em dia inexistente (bens, P22). */
export function lerDataCivil(v: string): Date | null {
  const dia = diaCivil(v);
  return dia === null ? null : new Date(dia * DIA_MS);
}

export function validarCapa(bruto: Readonly<Record<string, unknown>>): Resultado<CapaValidada> {
  const v = Object.fromEntries([...OBRIGATORIOS, 'parceiro'].map((c) => [c, texto(bruto[c])])) as Record<(typeof OBRIGATORIOS)[number] | 'parceiro', string>;
  const erros: ErroCampo[] = [];

  // E1 do UC 3.05: a mensagem completa uma vez, e cada campo em branco marcado.
  const vazios = OBRIGATORIOS.filter((c) => v[c] === '');
  if (vazios.length > 0) erros.push({ campo: '_', mensagem: M.PROPOSTA_OBRIGATORIOS }, ...vazios.map((campo) => ({ campo, mensagem: M.PROPOSTA_CAMPO_OBRIGATORIO })));

  if (v.tipo !== '' && !pertence(TIPOS_PROPOSTA, v.tipo)) erros.push({ campo: 'tipo', mensagem: M.PROPOSTA_TIPO_INVALIDO });
  if (contarCaracteres(v.numero) > LIMITE_NUMERO_TP) erros.push({ campo: 'numero', mensagem: M.PROPOSTA_NUMERO_LONGO(LIMITE_NUMERO_TP) });
  if (contarCaracteres(v.objeto) > LIMITE_OBJETO) erros.push({ campo: 'objeto', mensagem: M.PROPOSTA_OBJETO_LONGO(LIMITE_OBJETO) });
  if (contarCaracteres(v.parceiro) > LIMITE_PARCEIRO) erros.push({ campo: 'parceiro', mensagem: M.PROPOSTA_PARCEIRO_LONGO(LIMITE_PARCEIRO) });

  const inicio = v.inicio === '' ? null : diaCivil(v.inicio);
  const fim = v.fim === '' ? null : diaCivil(v.fim);
  if (v.inicio !== '' && inicio === null) erros.push({ campo: 'inicio', mensagem: M.PROPOSTA_DATA_INVALIDA });
  if (v.fim !== '' && fim === null) erros.push({ campo: 'fim', mensagem: M.PROPOSTA_DATA_INVALIDA });
  // E2 do UC 3.05 com a regra mais estrita (RN_TP_002).
  if (inicio !== null && fim !== null && fim - inicio < VIGENCIA_MINIMA_DIAS) erros.push({ campo: 'fim', mensagem: M.PROPOSTA_VIGENCIA_CURTA });

  if (v.categoria !== '' && !pertence(CATEGORIAS_PROPOSTA, v.categoria)) erros.push({ campo: 'categoria', mensagem: M.PROPOSTA_CATEGORIA_INVALIDA });

  if (erros.length > 0) return falha(erros);
  return ok({
    tipo: v.tipo as TipoProposta,
    numero: v.numero,
    objeto: v.objeto,
    parceiro: v.parceiro === '' ? null : v.parceiro,
    inicio: v.inicio,
    fim: v.fim,
    categoria: v.categoria as CategoriaProposta,
    cc: v.cc,
  });
}

/** Nome da unidade do TP: o objeto cortado em 120 caracteres (D-P17-2). */
export const nomeDaUnidade = (objeto: string): string => [...objeto].slice(0, LIMITE_NOME_UNIDADE).join('');

const PREFIXO_COPIA = 'Cópia de ';

/** Objeto da proposta duplicada (RN_DUP_002; D-P18-3): "Cópia de " + o objeto, cortado em 500 caracteres. */
export const objetoDaCopia = (objeto: string): string => [...`${PREFIXO_COPIA}${objeto}`].slice(0, LIMITE_OBJETO).join('');
