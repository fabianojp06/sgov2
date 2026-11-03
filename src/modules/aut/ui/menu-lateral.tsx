'use client';

import { useState } from 'react';
import { filtrarMenu, type MenuModulo } from '../application/menu';

// Menu por módulo → grupo → funcionalidade (RN0027), com a busca local (o servidor já mandou só o
// que é permitido).
export function MenuLateral({ menu }: { menu: readonly MenuModulo[] }) {
  const [termo, setTermo] = useState('');
  const visivel = filtrarMenu(menu, termo);
  return (
    <nav aria-label="Menu" className="sgo-menu">
      <label htmlFor="busca-funcionalidade">Buscar funcionalidade</label>
      <input id="busca-funcionalidade" type="search" value={termo} onChange={(e) => setTermo(e.target.value)} />
      {visivel.map((m) => (
        <section key={m.codigo}>
          <h2>{m.nome}</h2>
          {m.grupos.map((g) => (
            <div key={g.nome}>
              <h3>{g.nome}</h3>
              <ul>
                {g.itens.map((i) => (
                  <li key={i.codigo}>
                    <a href={i.rota}>{i.nome}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </nav>
  );
}
