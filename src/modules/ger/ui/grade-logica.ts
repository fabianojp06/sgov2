// Lógica pura da GradeArvore (sem React), testada diretamente.
import type { ValorCelula, TipoColuna } from '../domain/celula';

export type LinhaGrade<C extends string = string> = Readonly<Record<C, ValorCelula>>;

export type ColunaGrade<C extends string = string> = {
  campo: C; // chave em LinhaGrade
  titulo: string;
  tipo: TipoColuna;
  largura?: number; // px
};

export type NoGrade<C extends string = string> = {
  id: string;
  linha: LinhaGrade<C>;
  href?: string; // navegação pela primeira célula; só caminho interno (começando por "/")
  filhos?: readonly NoGrade<C>[];
};

export type Expansao = 'todos' | 'nenhum' | readonly string[];
export type LinhaVisivel<C extends string = string> = { no: NoGrade<C>; nivel: number };

function idsComFilhos(nos: readonly NoGrade<string>[], acc: string[] = []): string[] {
  for (const no of nos) {
    if (no.filhos?.length) {
      acc.push(no.id);
      idsComFilhos(no.filhos, acc);
    }
  }
  return acc;
}

export function expansaoInicial(nos: readonly NoGrade<string>[], expandidos: Expansao | undefined): Set<string> {
  if (expandidos === 'todos') return new Set(idsComFilhos(nos));
  if (expandidos === undefined || expandidos === 'nenhum') return new Set();
  return new Set(expandidos);
}

export function visiveis<C extends string>(
  nos: readonly NoGrade<C>[],
  abertos: ReadonlySet<string>,
  nivel = 1,
  acc: LinhaVisivel<C>[] = [],
): LinhaVisivel<C>[] {
  for (const no of nos) {
    acc.push({ no, nivel });
    if (no.filhos?.length && abertos.has(no.id)) visiveis(no.filhos, abertos, nivel + 1, acc);
  }
  return acc;
}

// Expansão retida na sessão (RNF0005): texto salvo → conjunto; qualquer coisa inesperada → undefined.
export function lerExpansaoSalva(texto: string | null): Set<string> | undefined {
  if (!texto) return undefined;
  try {
    const valor: unknown = JSON.parse(texto);
    if (Array.isArray(valor) && valor.every((v) => typeof v === 'string')) return new Set(valor);
  } catch {
    // texto corrompido: ignora
  }
  return undefined;
}

export const chaveSessao = (idGrade: string) => `sgo.grade.${idGrade}.expandidos`;
