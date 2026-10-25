import { ErroDominio } from '@/shared/kernel';

export type NoArvore = { id: string; paiId: string | null; tipo: 'SINTETICA' | 'ANALITICA' };

export type ArvoreIndexada = {
  porId: ReadonlyMap<string, NoArvore>;
  raizes: readonly string[];
  // Pós-ordem: todo filho aparece antes do pai.
  posOrdem: readonly string[];
};

// Valida a árvore (ids únicos, pai existente, sem ciclo, analítica sem filhos, valor só em
// analítica existente) e devolve os índices para somar em pós-ordem.
export function indexarArvore(nos: readonly NoArvore[], idsComValor: Iterable<string>): ArvoreIndexada {
  const porId = new Map<string, NoArvore>();
  for (const no of nos) {
    if (porId.has(no.id)) throw new ErroDominio('ID_DUPLICADO', `Nó repetido na árvore: ${no.id}`, { id: no.id });
    porId.set(no.id, no);
  }

  const filhos = new Map<string, string[]>();
  const raizes: string[] = [];
  for (const no of nos) {
    if (no.paiId === null) {
      raizes.push(no.id);
      continue;
    }
    const pai = porId.get(no.paiId);
    if (!pai) {
      throw new ErroDominio('PAI_INEXISTENTE', `Nó ${no.id} aponta para pai inexistente ${no.paiId}`, {
        id: no.id,
        paiId: no.paiId,
      });
    }
    if (pai.tipo === 'ANALITICA') {
      throw new ErroDominio('ANALITICA_COM_FILHOS', `Conta analítica ${pai.id} não pode ter filhos`, { id: pai.id });
    }
    const lista = filhos.get(no.paiId) ?? [];
    lista.push(no.id);
    filhos.set(no.paiId, lista);
  }

  // Pós-ordem iterativa a partir das raízes. Nó não alcançado a partir de uma raiz está num ciclo.
  const posOrdem: string[] = [];
  const pilha: { id: string; expandido: boolean }[] = raizes.map((id) => ({ id, expandido: false }));
  while (pilha.length > 0) {
    const topo = pilha.pop()!;
    if (topo.expandido) {
      posOrdem.push(topo.id);
      continue;
    }
    pilha.push({ id: topo.id, expandido: true });
    for (const filho of filhos.get(topo.id) ?? []) pilha.push({ id: filho, expandido: false });
  }
  if (posOrdem.length !== nos.length) {
    const alcancados = new Set(posOrdem);
    const noCiclo = nos.filter((n) => !alcancados.has(n.id)).map((n) => n.id);
    throw new ErroDominio('CICLO', `Ciclo na árvore envolvendo: ${noCiclo.slice(0, 5).join(', ')}`, { ids: noCiclo });
  }

  for (const id of idsComValor) {
    const no = porId.get(id);
    if (!no) throw new ErroDominio('NO_INEXISTENTE', `Valor informado para nó inexistente: ${id}`, { id });
    if (no.tipo === 'SINTETICA') {
      throw new ErroDominio('VALOR_EM_SINTETICA', `Conta sintética ${id} não recebe valor: é sempre calculada`, { id });
    }
  }

  return { porId, raizes, posOrdem };
}
