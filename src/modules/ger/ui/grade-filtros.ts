// Filtros declarativos da GradeArvore (US-021, R18; plano do P4, Task 6c). Lógica pura: aplicada no
// cliente sobre a árvore; um nó aparece se ele ou algum descendente casa, e os ancestrais de quem
// casa abrem. O estado fica no sessionStorage, com o escopo da sessão (nunca no localStorage).
import { falha, ok, type Resultado } from '@/shared/kernel';
import type { NoGrade } from './grade-logica';

export type DefinicaoFiltro<C extends string = string> =
  | { tipo: 'texto'; id: string; rotulo: string; campos: readonly C[] }
  | { tipo: 'selecao'; id: string; rotulo: string; campo: C; opcoes: readonly { valor: string; rotulo: string }[] }
  | { tipo: 'ocultarZerados'; id: string; rotulo: string; campos: readonly C[] }; // RF0006

export type ValoresFiltro = Readonly<Record<string, string | boolean>>;

const LIMITE_TEXTO = 100;
const CONTROLE = /\p{Cc}/u;
const normalizar = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// Valor "zero" de uma célula numérica (dinheiro e percentual chegam como texto decimal).
const ehZero = (v: string | null | undefined) => v === null || v === undefined || v === '' || /^-?0+(\.0+)?$/.test(v);

type Casar<C extends string> = (no: NoGrade<C>) => boolean;

function criterios<C extends string>(defs: readonly DefinicaoFiltro<C>[], valores: ValoresFiltro): Casar<C>[] {
  const lista: Casar<C>[] = [];
  for (const d of defs) {
    const v = valores[d.id];
    if (d.tipo === 'texto' && typeof v === 'string' && v.trim() !== '') {
      const alvo = normalizar(v.trim());
      lista.push((no) => d.campos.some((c) => normalizar(no.linha[c] ?? '').includes(alvo)));
    } else if (d.tipo === 'selecao' && typeof v === 'string' && v !== '') {
      lista.push((no) => no.linha[d.campo] === v);
    } else if (d.tipo === 'ocultarZerados' && v === true) {
      lista.push((no) => d.campos.some((c) => !ehZero(no.linha[c])));
    }
  }
  return lista;
}

/**
 * Aplica os filtros: um nó fica se casa com todos os critérios ou se tem descendente que casa.
 * Devolve também os ids a abrir (ancestrais de quem casou). Sem filtro ativo, a mesma referência.
 */
export function aplicarFiltros<C extends string>(
  nos: readonly NoGrade<C>[],
  defs: readonly DefinicaoFiltro<C>[],
  valores: ValoresFiltro,
): { nos: readonly NoGrade<C>[]; abrir: ReadonlySet<string> } {
  const lista = criterios(defs, valores);
  if (lista.length === 0) return { nos, abrir: new Set() };
  const abrir = new Set<string>();
  const filtrar = (ns: readonly NoGrade<C>[]): NoGrade<C>[] => {
    const saida: NoGrade<C>[] = [];
    for (const no of ns) {
      const filhos = no.filhos ? filtrar(no.filhos) : [];
      const casa = lista.every((f) => f(no));
      if (filhos.length > 0) abrir.add(no.id);
      if (casa || filhos.length > 0) saida.push(filhos.length > 0 || no.filhos ? { ...no, filhos } : no);
    }
    return saida;
  };
  return { nos: filtrar(nos), abrir };
}

/** RF0003: só valores conhecidos, texto de até 100 caracteres sem controle, opção existente. */
export function validarValoresFiltro(defs: readonly DefinicaoFiltro[], valores: unknown): Resultado<ValoresFiltro> {
  if (valores === null || typeof valores !== 'object' || Array.isArray(valores)) return falha([{ campo: 'filtros', mensagem: 'Filtros inválidos.' }]);
  const erros: { campo: string; mensagem: string }[] = [];
  const saida: Record<string, string | boolean> = {};
  for (const d of defs) {
    const v = (valores as Record<string, unknown>)[d.id];
    if (v === undefined || v === '') continue;
    if (d.tipo === 'texto') {
      if (typeof v !== 'string' || v.length > LIMITE_TEXTO || CONTROLE.test(v)) {
        erros.push({ campo: d.id, mensagem: `O filtro "${d.rotulo}" aceita até ${LIMITE_TEXTO} caracteres de texto.` });
      } else saida[d.id] = v;
    } else if (d.tipo === 'selecao') {
      if (typeof v !== 'string' || !d.opcoes.some((o) => o.valor === v)) erros.push({ campo: d.id, mensagem: `Opção inválida em "${d.rotulo}".` });
      else saida[d.id] = v;
    } else if (typeof v !== 'boolean') erros.push({ campo: d.id, mensagem: `Valor inválido em "${d.rotulo}".` });
    else saida[d.id] = v;
  }
  return erros.length > 0 ? falha(erros) : ok(saida);
}

export const chaveFiltros = (idGrade: string) => `sgo.grade.${idGrade}.filtros`;

/** Filtros salvos nesta sessão; de outra sessão (escopo diferente) ou corrompidos → undefined. */
export function lerFiltrosSalvos(texto: string | null, escopo: string | undefined): ValoresFiltro | undefined {
  if (!texto || !escopo) return undefined;
  try {
    const v: unknown = JSON.parse(texto);
    if (v === null || typeof v !== 'object') return undefined;
    const { escopo: salvo, valores } = v as { escopo?: unknown; valores?: unknown };
    if (salvo !== escopo || valores === null || typeof valores !== 'object' || Array.isArray(valores)) return undefined;
    const limpos = Object.entries(valores as Record<string, unknown>).filter(([, x]) => typeof x === 'string' || typeof x === 'boolean');
    return Object.fromEntries(limpos) as ValoresFiltro;
  } catch {
    return undefined;
  }
}
