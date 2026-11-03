'use client';

import { usePathname } from 'next/navigation';
import { MENSAGEM_ERRO_PAGINA } from './(sistema)/aut/sair-erro';
import { SairComConfirmacao } from './(sistema)/aut/sair-com-confirmacao';

// Sem sessão para encerrar: o Sair não aparece no erro dessas páginas.
const SEM_SESSAO = new Set(['/', '/login']);

// Fronteira de erro da raiz: pega o que escapa das páginas fora da área logada e o erro de render da
// casca da área logada (TelaPrincipal), que o error.tsx de (sistema) não envolve. Sem ela, aparecia a
// página padrão do Next, em inglês. Mesmo texto e mesmas saídas do erro de página: Tentar novamente
// (retry do Next) e Sair com confirmação. Depende de dois arquivos da frente A em (sistema)/aut.
export default function ErroRaiz({ retry }: { error: Error; reset: () => void; retry: () => void }) {
  const caminho = usePathname();
  return (
    <main>
      <p role="alert">{MENSAGEM_ERRO_PAGINA}</p>
      <button type="button" onClick={retry}>
        Tentar novamente
      </button>
      {SEM_SESSAO.has(caminho) ? null : <SairComConfirmacao />}
    </main>
  );
}
