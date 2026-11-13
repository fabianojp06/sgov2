import type { FiltrosPessoal } from '../application/pessoal-comum';
import { ROTULO_TIPO_PROPOSTA, TIPOS_PROPOSTA } from '../domain/proposta';

// Filtros das telas de pessoal da proposta (US-070; plano do P20, Task 2): Tipo, Proposta e Meta, juntos ou
// sozinhos (REQ0024) e por parte do texto (REQ0030), num formulário GET, como na tela de metas.
export function FiltrosPessoalProposta({ rota, rotulo, prefixo, filtros }: { rota: string; rotulo: string; prefixo: string; filtros: FiltrosPessoal }) {
  const id = (campo: string) => `${prefixo}-filtro-${campo}`;
  return (
    <form method="get" action={rota} role="search" aria-label={rotulo}>
      <label htmlFor={id('tipo')}>Tipo</label>
      <select id={id('tipo')} name="tipo" defaultValue={filtros.tipo ?? ''}>
        <option value="">Todos</option>
        {TIPOS_PROPOSTA.map((t) => (
          <option key={t} value={t}>
            {ROTULO_TIPO_PROPOSTA[t]}
          </option>
        ))}
      </select>{' '}
      <label htmlFor={id('proposta')}>Proposta</label>
      <input id={id('proposta')} name="proposta" defaultValue={filtros.proposta ?? ''} />{' '}
      <label htmlFor={id('meta')}>Meta</label>
      <input id={id('meta')} name="meta" defaultValue={filtros.meta ?? ''} /> <button type="submit">Pesquisar</button>
    </form>
  );
}

/** "AAAA-MM" → "MM/AAAA". */
export const mesAno = (competencia: string) => `${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`;
