'use client';

import { useMemo, useState } from 'react';
import { GradeArvore } from '@/modules/ger';
import { FILTROS_CONTAS, podarInativas, type ColunaConta, type NoContaTela } from './arvore-contas-logica';

// Consulta do plano de contas em árvore, só leitura (US-044; C27, RN_PLA_001): a estrutura só muda
// pela importação da planilha, então não há Novo, Alterar nem Excluir. As inativas ficam de fora
// até o usuário pedir "Mostrar inativas".
export function ArvoreContas({ nos, escopoSessao }: { nos: readonly NoContaTela[]; escopoSessao: string }) {
  const [mostrarInativas, setMostrarInativas] = useState(false);
  const visiveis = useMemo(() => (mostrarInativas ? nos : podarInativas(nos)), [nos, mostrarInativas]);
  return (
    <section>
      <label>
        <input type="checkbox" checked={mostrarInativas} onChange={(e) => setMostrarInativas(e.target.checked)} /> Mostrar inativas
      </label>
      <GradeArvore<ColunaConta>
        idGrade="cad.plano_contas"
        rotulo="Plano de contas"
        nos={visiveis}
        colunas={[
          { campo: 'classificacao', titulo: 'Classificação', tipo: 'texto' },
          { campo: 'reduzido', titulo: 'Reduzido', tipo: 'texto' },
          { campo: 'descricao', titulo: 'Descrição', tipo: 'texto' },
          { campo: 'nivel', titulo: 'Nível', tipo: 'texto' },
          { campo: 'tipo', titulo: 'Tipo', tipo: 'texto' },
          { campo: 'situacao', titulo: 'Situação', tipo: 'texto' },
        ]}
        filtros={FILTROS_CONTAS}
        escopoSessao={escopoSessao}
        textoVazio="Nenhuma conta cadastrada. O plano de contas entra pela importação da planilha."
      />
    </section>
  );
}
