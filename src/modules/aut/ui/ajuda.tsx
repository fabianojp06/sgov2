'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ajudaDaRota, type MenuModulo } from '../application/menu';

const SEM_AJUDA = 'Conteúdo de ajuda não disponível para esta funcionalidade.';

// Conteúdo da ajuda da tela atual (RN0032; E3 sem conteúdo).
export function AjudaConteudo({ menu, caminho }: { menu: readonly MenuModulo[]; caminho: string }) {
  const item = ajudaDaRota(menu, caminho);
  return (
    <section aria-label="Ajuda">
      {item?.ajuda ? (
        <>
          <h2>{item.nome}</h2>
          <p>{item.ajuda}</p>
        </>
      ) : (
        <p>{SEM_AJUDA}</p>
      )}
    </section>
  );
}

// Botão Ajuda da barra de status (REQ0046).
export function Ajuda({ menu }: { menu: readonly MenuModulo[] }) {
  const caminho = usePathname() ?? '/';
  const [aberta, setAberta] = useState(false);
  return (
    <>
      <button type="button" aria-expanded={aberta} onClick={() => setAberta(!aberta)}>
        Ajuda
      </button>
      {aberta ? <AjudaConteudo menu={menu} caminho={caminho} /> : null}
    </>
  );
}
