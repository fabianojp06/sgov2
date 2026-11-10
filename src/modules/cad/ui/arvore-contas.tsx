'use client';

import { textoVazioContas, type ColunaConta, type NoContaTela } from '../domain/arvore-tela';
import { COLUNAS_CONTAS, FILTROS_CONTAS } from './arvore-contas-logica';
import { ArvoreEstrutura } from './arvore-estrutura';

// Consulta do plano de contas em árvore, só leitura (US-044).
export function ArvoreContas({ nos, escopoSessao, exportar }: { nos: readonly NoContaTela[]; escopoSessao: string; exportar?: string }) {
  return (
    <ArvoreEstrutura<ColunaConta>
      idGrade="cad.plano_contas"
      rotulo="Plano de contas"
      rotuloInativos="Mostrar inativas"
      nos={nos}
      colunas={COLUNAS_CONTAS.map(({ campo, titulo }) => ({ campo, titulo, tipo: 'texto' as const }))}
      filtros={FILTROS_CONTAS}
      escopoSessao={escopoSessao}
      textoVazio={textoVazioContas(nos)}
      {...(exportar ? { exportar } : {})}
    />
  );
}
