// Apoio do error.tsx da área logada. Ele é componente cliente e não importa @/modules/* (o index do
// aut carrega código de servidor), então repete aqui a saída do UC01.04; os testes do aut conferem que
// os dois lados batem. A falha do catálogo e das permissões (UC01.03 E1 e E2) é tratada no próprio
// layout, com o ErroCarregamento: o error.tsx do segmento só pega o erro de uma página, e por isso
// tem texto próprio [PROVISÓRIO], sem falar em módulos.
export const MENSAGEM_ERRO_PAGINA = 'Não foi possível exibir esta página. Tente novamente ou contate o Administrador.';

const PREFIXO = 'sgo:';

type Armazenamento = { readonly length: number; key(i: number): string | null; removeItem(chave: string): void };

// Saída na falha persistente (E1.3): mesma sequência do sairDoSistema do aut. Apaga o estado de tela,
// encerra a sessão no servidor (LOGOFF no Histórico) e sempre termina em /login?saiu=1.
export async function sairComErro(
  buscar: (url: string, init: RequestInit) => Promise<Response>,
  local: { replace(url: string): void },
  armazenamento: Armazenamento,
  tempoLimiteMs = 5000,
): Promise<void> {
  const chaves: string[] = [];
  for (let i = 0; i < armazenamento.length; i++) {
    const c = armazenamento.key(i);
    if (c?.startsWith(PREFIXO)) chaves.push(c);
  }
  for (const c of chaves) armazenamento.removeItem(c);
  try {
    await buscar('/aut/sair', { method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(tempoLimiteMs) });
  } catch {
    // Sem rede ou sem resposta: segue para o login mesmo assim.
  }
  local.replace('/login?saiu=1');
}
