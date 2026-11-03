import type { PrismaClient } from '@/generated/prisma/client';
import { obterEscopoCentroCusto } from '@/modules/adm';
import {
  calcularCustoPosicao,
  carregarIndiceEstrutura,
  congelarPremissasExercicio,
  garantirPremissasExercicio,
  listarArvoreCentrosCusto,
  listarArvoreContas,
  obterPremissasExercicio,
} from '@/modules/cad/servidor';
import type { ContextoRequisicao } from '@/shared/authz';
import { prisma } from '@/shared/db';
import type { Percentual } from '@/shared/kernel';

// Semáforo do teto (C7, RN_PLA_006): faixas por exercício e classificação ficam no cad (Task 9a do
// P4, R12). Até elas chegarem à main, a visão funciona sem semáforo (com aviso).
export type FaixaSemaforo = 'VERDE' | 'AMARELO' | 'LARANJA' | 'VERMELHO';
export type FaixasSemaforo = { verdeAte: Percentual; amareloAte: Percentual; laranjaAte: Percentual };
export type ProvedorSemaforo = {
  faixas(ctx: ContextoRequisicao, ano: number): Promise<FaixasSemaforo | null>;
  classificar(uso: Percentual | null, faixas: FaixasSemaforo): FaixaSemaforo | null;
};

// Dependências dos casos de uso do orc (R1 do plano do P6): o C1 e o C2 do cad e o CC de escopo do
// adm chegam por injeção; os testes usam os falsos do cad.
export type DepsOrc = {
  cliente: PrismaClient;
  agora: () => Date;
  estrutura: {
    carregarIndiceEstrutura: typeof carregarIndiceEstrutura;
    listarArvoreCentrosCusto: typeof listarArvoreCentrosCusto;
    listarArvoreContas: typeof listarArvoreContas;
  };
  custoPessoal: {
    calcularCustoPosicao: typeof calcularCustoPosicao;
    obterPremissasExercicio: typeof obterPremissasExercicio;
    garantirPremissasExercicio: typeof garantirPremissasExercicio;
    congelarPremissasExercicio: typeof congelarPremissasExercicio;
  };
  obterEscopo: typeof obterEscopoCentroCusto;
  semaforo: ProvedorSemaforo | null;
};

export function resolverDeps(deps: Partial<DepsOrc> = {}): DepsOrc {
  return {
    cliente: deps.cliente ?? prisma,
    agora: deps.agora ?? (() => new Date()),
    estrutura: deps.estrutura ?? { carregarIndiceEstrutura, listarArvoreCentrosCusto, listarArvoreContas },
    custoPessoal: deps.custoPessoal ?? {
      calcularCustoPosicao,
      obterPremissasExercicio,
      garantirPremissasExercicio,
      congelarPremissasExercicio,
    },
    obterEscopo: deps.obterEscopo ?? obterEscopoCentroCusto,
    semaforo: deps.semaforo ?? null,
  };
}
