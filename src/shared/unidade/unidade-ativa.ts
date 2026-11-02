// Unidade (TP) ativa do usuário (spec §5 e §6.7). Uma só vira a ativa sem escolha; uma escolha fora
// da lista do usuário vale como nenhuma (o servidor nunca confia no cookie).
export function resolverUnidadeAtiva(unidades: readonly { id: string }[], escolhida: string | null): string | null {
  if (unidades.length === 1) return unidades[0]?.id ?? null;
  return escolhida !== null && unidades.some((u) => u.id === escolhida) ? escolhida : null;
}
