import type { PrismaClient } from '@/generated/prisma/client';
import { obterEscopoCentroCusto } from '@/modules/adm';
import {
  beneficiosDoCargo,
  calcularCustoPosicao,
  carregarIndiceEstrutura,
  congelarPremissasExercicio,
  garantirPremissasExercicio,
  listarArvoreCentrosCusto,
  listarArvoreContas,
  listarCargosSemSalarioCifrado,
  obterPremissasExercicio,
  type CargoExercicio,
  type OpcoesCargosExercicio,
} from '@/modules/cad/servidor';
import type { TxCliente } from '@/shared/db';
import type { ContextoRequisicao } from '@/shared/authz';
import { prisma } from '@/shared/db';
import type { Percentual } from '@/shared/kernel';

// Semáforo do teto (C7, RN_PLA_006): faixas por exercício e classificação ficam no cad (#234). A
// página da visão injeta o provedorSemaforo do cad; sem ele (null), a visão sai sem semáforo, com aviso.
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
    // C2, acréscimo de C&S (P15): sem a cifra, para o motor, os nomes e a lista (D-P15-3).
    listarCargosSemSalarioCifrado: typeof listarCargosSemSalarioCifrado;
    beneficiosDoCargo: typeof beneficiosDoCargo;
  };
  /**
   * Cargos com o salário da Fonte Ativa decifrado (listarCargosExercicio do index do cad), só para a
   * escolha do cargo na posição (D-P15-2). Opcional: sem ele, o caso de uso importa o index do cad na
   * hora (await import), para o orc não levar a cifra ao caminho da seed, da importação e do worker.
   */
  cargosDecifrados?: (tx: TxCliente, opcoes?: OpcoesCargosExercicio) => Promise<readonly CargoExercicio[]>;
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
      listarCargosSemSalarioCifrado,
      beneficiosDoCargo,
    },
    ...(deps.cargosDecifrados ? { cargosDecifrados: deps.cargosDecifrados } : {}),
    obterEscopo: deps.obterEscopo ?? obterEscopoCentroCusto,
    semaforo: deps.semaforo ?? null,
  };
}
