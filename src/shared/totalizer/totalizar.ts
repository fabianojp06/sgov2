import Decimal from 'decimal.js';
import { Dinheiro, ErroDominio, Percentual } from '@/shared/kernel';
import { indexarArvore, rotulo, type ArvoreIndexada, type NoArvore } from './arvore';

export type ResultadoTotalizacao = {
  readonly valor: (id: string) => Dinheiro;
  readonly total: Dinheiro;
  // null quando o nó é raiz (não tem pai) ou quando o pai vale zero (RN_OXR_012).
  readonly percentualDoPai: (id: string) => Percentual | null;
  readonly percentualDoTotal: (id: string) => Percentual | null;
};

export type ResultadoSerie = {
  readonly valor: (id: string) => readonly Dinheiro[];
  readonly total: readonly Dinheiro[];
};

// Somas intermediárias em Decimal: o limite de NUMERIC(15,2) vale para o valor de cada nó
// pronto, não para a ordem em que os filhos são somados.
const Soma = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

function buscar<T>(mapa: ReadonlyMap<string, T>, id: string): T {
  const v = mapa.get(id);
  if (v === undefined) throw new ErroDominio('NO_INEXISTENTE', `Nó inexistente na árvore: ${rotulo(id)}`, { id });
  return v;
}

function comoDinheiro(id: string, soma: Decimal): Dinheiro {
  try {
    return Dinheiro.de(soma);
  } catch (erro) {
    if (erro instanceof ErroDominio && erro.codigo === 'VALOR_FORA_DO_LIMITE') {
      throw new ErroDominio('VALOR_FORA_DO_LIMITE', `A soma da conta ${rotulo(id)} passou do limite de valor`, {
        id,
      });
    }
    throw erro;
  }
}

function somar(
  nos: readonly NoArvore[],
  arvore: ArvoreIndexada,
  valores: ReadonlyMap<string, Dinheiro>,
): ResultadoTotalizacao {
  const somas = new Map<string, Decimal>(nos.map((n) => [n.id, new Soma(0)]));
  for (const [id, v] of valores) somas.set(id, new Soma(v.paraString()));
  const dinheiro = new Map<string, Dinheiro>();
  for (const id of arvore.posOrdem) {
    const valor = comoDinheiro(id, buscar(somas, id));
    dinheiro.set(id, valor);
    const paiId = buscar(arvore.porId, id).paiId;
    if (paiId !== null) somas.set(paiId, buscar(somas, paiId).plus(valor.paraString()));
  }
  const total = comoDinheiro(
    'total',
    arvore.raizes.reduce((acc, id) => acc.plus(buscar(dinheiro, id).paraString()), new Soma(0)),
  );

  return Object.freeze({
    valor: (id: string) => buscar(dinheiro, id),
    total,
    percentualDoPai: (id: string) => {
      const paiId = buscar(arvore.porId, id).paiId;
      return paiId === null ? null : Percentual.razao(buscar(dinheiro, id), buscar(dinheiro, paiId));
    },
    percentualDoTotal: (id: string) => Percentual.razao(buscar(dinheiro, id), total),
  });
}

// Motor único de totais (US-009): função pura, sem I/O. As sintéticas são sempre calculadas a
// partir das analíticas e nunca persistidas como dado vivo. Analítica ausente do mapa vale zero.
// O total é a soma das raízes (RN_OXR_009): passe só a subárvore do escopo (ex.: despesas),
// para não somar grupos diferentes.
export function totalizar(nos: readonly NoArvore[], valores: ReadonlyMap<string, Dinheiro>): ResultadoTotalizacao {
  return somar(nos, indexarArvore(nos, valores.keys()), valores);
}

// Mesma totalização, mês a mês (12 meses por padrão). A árvore é validada uma vez só.
export function totalizarSerie(
  nos: readonly NoArvore[],
  valores: ReadonlyMap<string, readonly Dinheiro[]>,
  meses = 12,
): ResultadoSerie {
  if (!Number.isInteger(meses) || meses < 1) {
    throw new ErroDominio('MESES_INVALIDO', `Quantidade de meses inválida: ${meses}`, { meses });
  }
  for (const [id, serie] of valores) {
    if (serie.length !== meses) {
      throw new ErroDominio('SERIE_TAMANHO', `Série de ${rotulo(id)} com ${serie.length} meses; esperado ${meses}`, {
        id,
        meses: serie.length,
      });
    }
    for (let m = 0; m < meses; m++) {
      if (!(serie[m] instanceof Dinheiro)) {
        throw new ErroDominio('SERIE_INVALIDA', `Série de ${rotulo(id)} sem valor no mês ${m + 1}`, { id, mes: m + 1 });
      }
    }
  }
  const arvore = indexarArvore(nos, valores.keys());
  const porMes = Array.from({ length: meses }, (_, m) =>
    somar(nos, arvore, new Map([...valores].map(([id, serie]) => [id, serie[m]!]))),
  );
  return Object.freeze({
    valor: (id: string) => Object.freeze(porMes.map((r) => r.valor(id))),
    total: Object.freeze(porMes.map((r) => r.total)),
  });
}
