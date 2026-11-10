'use client';

import { textoVazioCc, type ColunaCc, type NoCcTela } from '../domain/arvore-tela';
import { COLUNAS_CC, FILTROS_CC } from './arvore-contas-logica';
import { ArvoreEstrutura } from './arvore-estrutura';

// Consulta dos centros de custo em árvore, só leitura (US-046 parte 2): o reduzido ao lado da
// classificação e os selos de gestão (R17) e de provisório (GAP-CC-001).
export function ArvoreCc({ nos, escopoSessao, exportar }: { nos: readonly NoCcTela[]; escopoSessao: string; exportar?: string }) {
  return (
    <ArvoreEstrutura<ColunaCc>
      idGrade="cad.centros_custo"
      rotulo="Centros de custo"
      rotuloInativos="Mostrar inativos"
      nos={nos}
      colunas={COLUNAS_CC.map(({ campo, titulo }) => ({ campo, titulo, tipo: 'texto' as const }))}
      filtros={FILTROS_CC}
      escopoSessao={escopoSessao}
      textoVazio={textoVazioCc(nos)}
      {...(exportar ? { exportar } : {})}
    />
  );
}
