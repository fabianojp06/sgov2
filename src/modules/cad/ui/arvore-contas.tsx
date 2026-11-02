'use client';

import { textoVazioContas, type ColunaConta, type NoContaTela } from '../domain/arvore-tela';
import { FILTROS_CONTAS } from './arvore-contas-logica';
import { ArvoreEstrutura } from './arvore-estrutura';

// Consulta do plano de contas em árvore, só leitura (US-044).
export function ArvoreContas({ nos, escopoSessao }: { nos: readonly NoContaTela[]; escopoSessao: string }) {
  return (
    <ArvoreEstrutura<ColunaConta>
      idGrade="cad.plano_contas"
      rotulo="Plano de contas"
      rotuloInativos="Mostrar inativas"
      nos={nos}
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
      textoVazio={textoVazioContas(nos)}
    />
  );
}
