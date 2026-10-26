// Menu da tela principal (UC01.03): montado a partir do catálogo ativo no banco (contrato C6) e das
// permissões do usuário. Funções puras; os dados chegam aos componentes cliente por props.

export type ItemCatalogo = {
  modulo: { codigo: string; nome: string; ordem: number };
  grupo: string;
  funcionalidade: { codigo: string; nome: string; rota: string; ordem: number; ajuda: string | null };
};
export type ItemMenu = { codigo: string; nome: string; rota: string; ajuda: string | null };
export type MenuModulo = { codigo: string; nome: string; grupos: readonly { nome: string; itens: readonly ItemMenu[] }[] };

// RN0027/RN0030 e R11: a funcionalidade aparece se o usuário tem qualquer ação nela. Módulo e grupo
// sem item somem; as permissões básicas (aut.*) nunca viram item.
export function montarMenu(catalogo: readonly ItemCatalogo[], permissoes: ReadonlySet<string>): readonly MenuModulo[] {
  const temAcesso = (codigo: string) => [...permissoes].some((p) => p.startsWith(`${codigo}:`));
  const ordenado = [...catalogo]
    .filter((c) => !c.funcionalidade.codigo.startsWith('aut.') && temAcesso(c.funcionalidade.codigo))
    .sort((x, y) => x.modulo.ordem - y.modulo.ordem || x.funcionalidade.ordem - y.funcionalidade.ordem);
  const modulos: { codigo: string; nome: string; grupos: { nome: string; itens: ItemMenu[] }[] }[] = [];
  for (const c of ordenado) {
    let m = modulos.find((x) => x.codigo === c.modulo.codigo);
    if (!m) modulos.push((m = { codigo: c.modulo.codigo, nome: c.modulo.nome, grupos: [] }));
    let g = m.grupos.find((x) => x.nome === c.grupo);
    if (!g) m.grupos.push((g = { nome: c.grupo, itens: [] }));
    const { codigo, nome, rota, ajuda } = c.funcionalidade;
    g.itens.push({ codigo, nome, rota, ajuda });
  }
  return modulos;
}

const semAcento = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// Busca de funcionalidade: sobre o menu já filtrado, então nunca acha o que não é permitido.
export function filtrarMenu(menu: readonly MenuModulo[], termo: string): readonly MenuModulo[] {
  const t = semAcento(termo.trim());
  if (!t) return menu;
  return menu
    .map((m) => ({
      ...m,
      grupos: m.grupos.map((g) => ({ ...g, itens: g.itens.filter((i) => semAcento(i.nome).includes(t)) })).filter((g) => g.itens.length > 0),
    }))
    .filter((m) => m.grupos.length > 0);
}

// Ajuda contextual (RN0032): a funcionalidade da tela atual é a de rota com o maior prefixo.
export function ajudaDaRota(menu: readonly MenuModulo[], caminho: string): ItemMenu | null {
  let achado: ItemMenu | null = null;
  for (const i of menu.flatMap((m) => m.grupos.flatMap((g) => g.itens))) {
    const casa = caminho === i.rota || caminho.startsWith(`${i.rota}/`);
    if (casa && (!achado || i.rota.length > achado.rota.length)) achado = i;
  }
  return achado;
}
