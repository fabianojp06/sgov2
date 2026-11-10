'use client';

import { useMemo, useState } from 'react';
import { GradeArvore, type ColunaGrade, type DefinicaoFiltro, type ValoresFiltro } from '@/modules/ger';
import { nosVisiveis, type NoTela } from '../domain/arvore-tela';
import { hrefExportacao } from './arvore-contas-logica';

// Consulta de estrutura em árvore, só leitura (US-044 e US-046; C27, RN_PLA_001): a estrutura só
// muda pela importação da planilha, então não há Novo, Alterar nem Excluir. Os inativos ficam de
// fora até o usuário marcar a caixa, que é só exibição (quem consulta já recebe a árvore inteira).
export function ArvoreEstrutura<C extends string>({
  idGrade,
  rotulo,
  rotuloInativos,
  nos,
  colunas,
  filtros,
  escopoSessao,
  textoVazio,
  exportar,
}: {
  idGrade: string;
  rotulo: string;
  rotuloInativos: string;
  nos: readonly NoTela<C>[];
  colunas: readonly ColunaGrade<C | 'situacao'>[];
  filtros: readonly DefinicaoFiltro<C | 'situacao'>[];
  escopoSessao: string;
  textoVazio: string;
  // Rota de exportação (US-024), só para quem tem a permissão: os links levam o "mostrar inativos" e
  // os filtros em uso, e o arquivo sai igual à tela.
  exportar?: string;
}) {
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [valores, setValores] = useState<ValoresFiltro>({});
  const visiveis = useMemo(() => nosVisiveis(nos, mostrarInativos), [nos, mostrarInativos]);
  return (
    <section>
      <label>
        <input type="checkbox" checked={mostrarInativos} onChange={(e) => setMostrarInativos(e.target.checked)} /> {rotuloInativos}
      </label>
      {exportar && (
        <p>
          Exportar o que está na tela: <a href={hrefExportacao(exportar, 'xlsx', mostrarInativos, valores)}>XLSX</a> ·{' '}
          <a href={hrefExportacao(exportar, 'csv', mostrarInativos, valores)}>CSV</a> ·{' '}
          <a href={hrefExportacao(exportar, 'pdf', mostrarInativos, valores)}>PDF</a>
        </p>
      )}
      <GradeArvore<C | 'situacao'>
        idGrade={idGrade}
        rotulo={rotulo}
        nos={visiveis}
        colunas={colunas}
        filtros={filtros}
        escopoSessao={escopoSessao}
        textoVazio={textoVazio}
        aoMudarFiltros={setValores}
      />
    </section>
  );
}
