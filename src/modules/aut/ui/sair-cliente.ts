// Saída do sistema no navegador (UC01.04). Sempre termina em /login?saiu=1, inclusive com 401,
// 500 ou sem rede (E1): o proxy limpa os cookies lá, e a sessão que sobrar no servidor expira
// pelo tempo de vida.
type Armazenamento = { readonly length: number; key(i: number): string | null; removeItem(chave: string): void };

const PREFIXO = 'sgo:';

export async function sairDoSistema(
  buscar: (url: string, init: RequestInit) => Promise<Response>,
  local: { replace(url: string): void },
  armazenamento: Armazenamento,
): Promise<void> {
  // Estados de tela guardados pelo sistema (filtros retidos, US-021) saem do navegador (RNF0010).
  const chaves: string[] = [];
  for (let i = 0; i < armazenamento.length; i++) {
    const c = armazenamento.key(i);
    if (c?.startsWith(PREFIXO)) chaves.push(c);
  }
  for (const c of chaves) armazenamento.removeItem(c);
  try {
    await buscar('/aut/sair', { method: 'POST', credentials: 'same-origin' });
  } catch {
    // Sem rede: segue para o login mesmo assim (E1.2).
  }
  local.replace('/login?saiu=1');
}
