import { falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { MENSAGENS_ORC as M } from './mensagens';
import { contarCaracteres } from './texto';

// Empregado e quantitativo de pessoal da proposta de TP (US-070, UC03.21, UC03.25 e UC03.26; plano do P20,
// D-P20-2, D-P20-3 e D-P20-6). Funções puras: a meta, o cargo e a sobreposição são conferidos no caso de uso.
// Os limites espelham os CHECKs da migration 202611132200_orc_empregado.

export const CATEGORIAS_EMPREGADO = ['EMPREGADO', 'ESTAGIARIO', 'JOVEM_APRENDIZ'] as const;
export type CategoriaEmpregado = (typeof CATEGORIAS_EMPREGADO)[number];
export const ROTULO_CATEGORIA_EMPREGADO: Readonly<Record<CategoriaEmpregado, string>> = {
  EMPREGADO: 'Empregado',
  ESTAGIARIO: 'Estagiário',
  JOVEM_APRENDIZ: 'Jovem Aprendiz',
};

/** O que a grade mostra no lugar do nome vazio (RN0249, REQ_EMP_003). */
export const A_CONTRATAR = 'A CONTRATAR';

export const LIMITE_NOME_EMPREGADO = 120;
export const DEPENDENTES_MAXIMO = 20;
export const LIMITE_DOCUMENTO_QTDE = 50;

/** Período de competências: o dia 1 do mês, em UTC. */
export type Competencias = { inicio: Date; fim: Date };

export type EmpregadoValidado = Competencias & {
  categoria: CategoriaEmpregado;
  /** Nulo: vaga "A CONTRATAR". */
  nome: string | null;
  cargoId: string;
  dependentes: number;
};

export type QtdeValidada = Competencias & { documento: string };

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** "AAAA-MM" (o input month) no dia 1 do mês em UTC; nulo fora do formato. */
export function lerCompetencia(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})$/.exec(v);
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  if (ano < 1900 || mes < 1 || mes > 12) return null;
  return new Date(Date.UTC(ano, mes - 1, 1));
}

/** A competência de uma data (o dia 1 do mês dela, em UTC). */
export const competenciaDe = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/** "AAAA-MM", para o input month e para o Histórico. */
export const competenciaParaTexto = (d: Date): string => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** "MM/AAAA", para a tela. */
export const competenciaParaTela = (d: Date): string => `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;

/** Os dois períodos têm alguma competência em comum (RN0155, RN0457). */
export const cruza = (a: Competencias, b: Competencias): boolean => a.inicio.getTime() <= b.fim.getTime() && b.inicio.getTime() <= a.fim.getTime();

/** Os meses (1..12) do ano dentro do período, para o motor; nulo se o período não toca o ano (D-P20-4). */
export function mesesDoAno(p: Competencias, ano: number): { mesInicio: number; mesSaida: number } | null {
  const ini = p.inicio.getUTCFullYear();
  const fim = p.fim.getUTCFullYear();
  if (ano < ini || ano > fim) return null;
  return { mesInicio: ano === ini ? p.inicio.getUTCMonth() + 1 : 1, mesSaida: ano === fim ? p.fim.getUTCMonth() + 1 : 12 };
}

/**
 * D-P20-3: início e fim são competências dentro da vigência da capa (RN0252 e RN0154), com o início até o
 * fim. A vigência vem em datas e vale pelo mês delas.
 */
function validarCompetencias(bruto: { inicio: string; fim: string }, vigencia: Competencias, erros: ErroCampo[]): Competencias | null {
  const inicio = bruto.inicio === '' ? null : lerCompetencia(bruto.inicio);
  const fim = bruto.fim === '' ? null : lerCompetencia(bruto.fim);
  if (bruto.inicio !== '' && !inicio) erros.push({ campo: 'inicio', mensagem: M.COMPETENCIA_INVALIDA });
  if (bruto.fim !== '' && !fim) erros.push({ campo: 'fim', mensagem: M.COMPETENCIA_INVALIDA });
  if (!inicio || !fim) return null;
  const vi = competenciaDe(vigencia.inicio);
  const vf = competenciaDe(vigencia.fim);
  const antes = erros.length;
  if (inicio < vi) erros.push({ campo: 'inicio', mensagem: M.COMPETENCIA_ANTES_DA_VIGENCIA(competenciaParaTela(vi)) });
  if (fim > vf) erros.push({ campo: 'fim', mensagem: M.COMPETENCIA_DEPOIS_DA_VIGENCIA(competenciaParaTela(vf)) });
  if (inicio > fim) erros.push({ campo: 'fim', mensagem: M.COMPETENCIA_FIM_ANTES_DO_INICIO });
  return erros.length === antes ? { inicio, fim } : null;
}

/**
 * RN0248, RN0249 e RN0252 (D-P20-2): categoria, cargo e competências obrigatórios; nome opcional (vazio é
 * "A CONTRATAR"); dependentes de 0 a 20 (vazio é 0). Meta e cargo são conferidos no caso de uso.
 */
export function validarEmpregado(bruto: Readonly<Record<string, unknown>>, vigencia: Competencias): Resultado<EmpregadoValidado> {
  const v = {
    categoria: texto(bruto.categoria),
    nome: texto(bruto.nome),
    cargoId: texto(bruto.cargoId),
    inicio: texto(bruto.inicio),
    fim: texto(bruto.fim),
    dependentes: texto(bruto.dependentes),
  };
  const erros: ErroCampo[] = [];
  const vazios = (['categoria', 'cargoId', 'inicio', 'fim'] as const).filter((c) => v[c] === '');
  if (vazios.length > 0) erros.push({ campo: '_', mensagem: M.EMPREGADO_OBRIGATORIOS }, ...vazios.map((campo) => ({ campo, mensagem: M.PROPOSTA_CAMPO_OBRIGATORIO })));
  if (v.categoria !== '' && !(CATEGORIAS_EMPREGADO as readonly string[]).includes(v.categoria)) erros.push({ campo: 'categoria', mensagem: M.EMPREGADO_CATEGORIA_INVALIDA });
  if (contarCaracteres(v.nome) > LIMITE_NOME_EMPREGADO) erros.push({ campo: 'nome', mensagem: M.EMPREGADO_NOME_LONGO(LIMITE_NOME_EMPREGADO) });
  const dependentes = v.dependentes === '' ? 0 : /^\d{1,2}$/.test(v.dependentes) ? Number(v.dependentes) : -1;
  if (dependentes < 0 || dependentes > DEPENDENTES_MAXIMO) erros.push({ campo: 'dependentes', mensagem: M.EMPREGADO_DEPENDENTES_INVALIDO(DEPENDENTES_MAXIMO) });
  const periodo = validarCompetencias(v, vigencia, erros);
  if (erros.length > 0 || !periodo) return falha(erros);
  return ok({ categoria: v.categoria as CategoriaEmpregado, nome: v.nome === '' ? null : v.nome, cargoId: v.cargoId, dependentes, ...periodo });
}

/** RN0153 e RN0154 (D-P20-6): período e número do documento obrigatórios; documento até 50. */
export function validarQtde(bruto: Readonly<Record<string, unknown>>, vigencia: Competencias): Resultado<QtdeValidada> {
  const v = { inicio: texto(bruto.inicio), fim: texto(bruto.fim), documento: texto(bruto.documento) };
  const erros: ErroCampo[] = [];
  const vazios = (['inicio', 'fim', 'documento'] as const).filter((c) => v[c] === '');
  if (vazios.length > 0) erros.push({ campo: '_', mensagem: M.QTDE_OBRIGATORIOS }, ...vazios.map((campo) => ({ campo, mensagem: M.PROPOSTA_CAMPO_OBRIGATORIO })));
  if (contarCaracteres(v.documento) > LIMITE_DOCUMENTO_QTDE) erros.push({ campo: 'documento', mensagem: M.QTDE_DOCUMENTO_LONGO(LIMITE_DOCUMENTO_QTDE) });
  const periodo = validarCompetencias(v, vigencia, erros);
  if (erros.length > 0 || !periodo) return falha(erros);
  return ok({ documento: v.documento, ...periodo });
}
