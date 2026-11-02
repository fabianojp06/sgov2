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

export const LIMITE_TEXTO_FILTRO = 100;
const LIMITE_TEXTO = LIMITE_TEXTO_FILTRO;
const CONTROLE = /\p{Cc}/u;
const normalizar = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// Valor "zero" de uma célula numérica (dinheiro e percentual chegam como texto decimal).
const ehZero = (v: string | null | undefined) => v === null || v === undefined || v === '' || /^-?0+(\.0+)?$/.test(v);

type Casar<C extends string> = (no: NoGrade<C>) => boolean;

function criterios<C extends string>(defs: readonly DefinicaoFiltro<C>[], valores: ValoresFiltro): { texto: Casar<C>[]; outros: Casar<C>[] } {
  const texto: Casar<C>[] = [];
  const outros: Casar<C>[] = [];
  for (const d of defs) {
    const v = valores[d.id];
    if (d.tipo === 'texto' && typeof v === 'string' && v.trim() !== '') {
      const alvo = normalizar(v.trim());
      texto.push((no) => d.campos.some((c) => normalizar(no.linha[c] ?? '').includes(alvo)));
    } else if (d.tipo === 'selecao' && typeof v === 'string' && v !== '') {
      outros.push((no) => no.linha[d.campo] === v);
    } else if (d.tipo === 'ocultarZerados' && v === true) {
      outros.push((no) => d.campos.some((c) => !ehZero(no.linha[c])));
    }
  }
  return { texto, outros };
}

/**
 * Aplica os filtros: um nó fica se casa com todos os critérios ou se tem descendente que casa.
 * Quem casa pela busca por texto leva a subárvore inteira, que passa só pelos outros critérios
 * (M5 do #222, decisão do PO: buscar "pessoal" mostra as contas abaixo de "DESPESAS DE PESSOAL").
 * Devolve também os ids a abrir: os ancestrais de quem casou pelo próprio texto, só quando há
 * busca (com seleção ou "ocultar zerados" sozinhos, a expansão do usuário fica como está, para não
 * abrir a árvore inteira). Sem filtro ativo, a mesma referência.
 */
export function aplicarFiltros<C extends string>(
  nos: readonly NoGrade<C>[],
  defs: readonly DefinicaoFiltro<C>[],
  valores: ValoresFiltro,
): { nos: readonly NoGrade<C>[]; abrir: ReadonlySet<string> } {
  const { texto, outros } = criterios(defs, valores);
  if (texto.length === 0 && outros.length === 0) return { nos, abrir: new Set() };
  const abrir = new Set<string>();
  // `herdado`: um ancestral casou pelo texto. Devolve também se alguém abaixo casou pelo próprio texto.
  const filtrar = (ns: readonly NoGrade<C>[], herdado: boolean): { saida: NoGrade<C>[]; achou: boolean } => {
    const saida: NoGrade<C>[] = [];
    let achou = false;
    for (const no of ns) {
      const casaTextoProprio = texto.length > 0 && texto.every((f) => f(no));
      const casaTexto = herdado || texto.every((f) => f(no));
      const sub = no.filhos ? filtrar(no.filhos, casaTexto) : { saida: [], achou: false };
      const filhos = sub.saida;
      if (sub.achou) abrir.add(no.id);
      achou ||= casaTextoProprio || sub.achou;
      const casa = casaTexto && outros.every((f) => f(no));
      if (casa || filhos.length > 0) saida.push(filhos.length > 0 || no.filhos ? { ...no, filhos } : no);
    }
    return { saida, achou };
  };
  return { nos: filtrar(nos, false).saida, abrir };
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
      // Tab e quebra de linha (texto colado do Excel) viram espaço; outro controle é recusado.
      const t = typeof v === 'string' ? v.replace(/[\t\n\r]/g, ' ') : null;
      if (t === null) erros.push({ campo: d.id, mensagem: `Valor inválido em "${d.rotulo}".` });
      else if (t.length > LIMITE_TEXTO) erros.push({ campo: d.id, mensagem: `O filtro "${d.rotulo}" aceita até ${LIMITE_TEXTO} caracteres.` });
      else if (CONTROLE.test(t)) erros.push({ campo: d.id, mensagem: `O filtro "${d.rotulo}" tem um caractere inválido.` });
      else saida[d.id] = t;
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

type Armazenamento = Pick<Storage, 'getItem'>;

/**
 * Filtros a restaurar ao montar a grade: só com o escopo da sessão (sem ele, o storage nem é lido) e
 * só valores que ainda passam nas definições atuais.
 */
export function restaurarFiltros(
  storage: Armazenamento,
  idGrade: string,
  escopo: string | undefined,
  defs: readonly DefinicaoFiltro[],
): ValoresFiltro | undefined {
  if (!escopo || defs.length === 0) return undefined;
  const salvos = lerFiltrosSalvos(storage.getItem(chaveFiltros(idGrade)), escopo);
  if (!salvos) return undefined;
  const v = validarValoresFiltro(defs, salvos);
  return v.ok ? v.valor : undefined;
}
