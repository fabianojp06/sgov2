import { estruturaDaAdmCentral } from './adm-central';
import type { PrismaClient } from '@/generated/prisma/client';
import { obterEscopoCentroCusto } from '@/modules/adm';
import {
  beneficiosDosCargos,
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
  /** O C1 visto pela Adm. Central: dos CCs, só a raiz 4 (C37). */
  estrutura: {
    carregarIndiceEstrutura: typeof carregarIndiceEstrutura;
    listarArvoreCentrosCusto: typeof listarArvoreCentrosCusto;
    listarArvoreContas: typeof listarArvoreContas;
  };
  /** O C1 inteiro, com a estrutura de TPs: só para a proposta de TP (R4). */
  estruturaCompleta: DepsOrc['estrutura'];
  custoPessoal: {
    calcularCustoPosicao: typeof calcularCustoPosicao;
    obterPremissasExercicio: typeof obterPremissasExercicio;
    garantirPremissasExercicio: typeof garantirPremissasExercicio;
    congelarPremissasExercicio: typeof congelarPremissasExercicio;
    // C2, acréscimo de C&S (P15): sem a cifra, para o motor, os nomes e a lista (D-P15-3).
    listarCargosSemSalarioCifrado: typeof listarCargosSemSalarioCifrado;
    beneficiosDosCargos: typeof beneficiosDosCargos;
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
    // Só a raiz 4 (C37): os CCs de TP não entram no orçamento da Adm. Central (adm-central.ts). Um falso
    // injetado passa pelo mesmo filtro. A estrutura inteira fica em estruturaCompleta (proposta de TP).
    estrutura: estruturaDaAdmCentral(deps.estruturaCompleta ?? deps.estrutura ?? { carregarIndiceEstrutura, listarArvoreCentrosCusto, listarArvoreContas }),
    estruturaCompleta: deps.estruturaCompleta ?? deps.estrutura ?? { carregarIndiceEstrutura, listarArvoreCentrosCusto, listarArvoreContas },
    custoPessoal: deps.custoPessoal ?? {
      calcularCustoPosicao,
      obterPremissasExercicio,
      garantirPremissasExercicio,
      congelarPremissasExercicio,
      listarCargosSemSalarioCifrado,
      beneficiosDosCargos,
    },
    ...(deps.cargosDecifrados ? { cargosDecifrados: deps.cargosDecifrados } : {}),
    obterEscopo: deps.obterEscopo ?? obterEscopoCentroCusto,
    semaforo: deps.semaforo ?? null,
  };
}
