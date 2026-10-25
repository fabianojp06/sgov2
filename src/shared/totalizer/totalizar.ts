import { Dinheiro, ErroDominio, Percentual } from '@/shared/kernel';
import { indexarArvore, type NoArvore } from './arvore';

export type ResultadoTotalizacao = {
  valor(id: string): Dinheiro;
  total: Dinheiro;
  percentualDoPai(id: string): Percentual | null;
  percentualDoTotal(id: string): Percentual | null;
};

function buscar<T>(mapa: ReadonlyMap<string, T>, id: string): T {
  const v = mapa.get(id);
  if (v === undefined) throw new ErroDominio('NO_INEXISTENTE', `Nó inexistente na árvore: ${id}`, { id });
  return v;
}

// Motor único de totais (US-009): função pura, sem I/O. As sintéticas são sempre calculadas a
// partir das analíticas e nunca persistidas como dado vivo. Analítica ausente do mapa vale zero.
// O total é a soma das raízes (RN_OXR_009).
export function totalizar(nos: readonly NoArvore[], valores: ReadonlyMap<string, Dinheiro>): ResultadoTotalizacao {
  const arvore = indexarArvore(nos, valores.keys());
  const somas = new Map<string, Dinheiro>(nos.map((n) => [n.id, valores.get(n.id) ?? Dinheiro.zero()]));
  for (const id of arvore.posOrdem) {
    const paiId = buscar(arvore.porId, id).paiId;
    if (paiId !== null) somas.set(paiId, buscar(somas, paiId).somar(buscar(somas, id)));
  }
  const total = Dinheiro.somarTodos(arvore.raizes.map((id) => buscar(somas, id)));

  return {
    valor: (id) => buscar(somas, id),
    total,
    percentualDoPai: (id) => {
      const paiId = buscar(arvore.porId, id).paiId;
      return paiId === null ? null : Percentual.razao(buscar(somas, id), buscar(somas, paiId));
    },
    percentualDoTotal: (id) => Percentual.razao(buscar(somas, id), total),
  };
}

// Mesma totalização, mês a mês (12 meses por padrão).
export function totalizarSerie(
  nos: readonly NoArvore[],
  valores: ReadonlyMap<string, readonly Dinheiro[]>,
  meses = 12,
): { valor(id: string): readonly Dinheiro[]; total: readonly Dinheiro[] } {
  for (const [id, serie] of valores) {
    if (serie.length !== meses) {
      throw new ErroDominio('SERIE_TAMANHO', `Série de ${id} com ${serie.length} meses; esperado ${meses}`, {
        id,
        meses: serie.length,
      });
    }
  }
  const porMes = Array.from({ length: meses }, (_, m) =>
    totalizar(nos, new Map([...valores].map(([id, serie]) => [id, serie[m]!]))),
  );
  return {
    valor: (id) => porMes.map((r) => r.valor(id)),
    total: porMes.map((r) => r.total),
  };
}
