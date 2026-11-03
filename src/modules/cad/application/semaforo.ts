import type { PrismaClient } from '@/generated/prisma/client';
import type { ContextoRequisicao } from '@/shared/authz';
import type { Percentual } from '@/shared/kernel';
import { classificarSemaforo, type FaixaSemaforo, type FaixasSemaforo } from '../domain/semaforo';
import { obterParametrosExercicio } from './parametros';

// Semáforo do uso do teto para o orc (#234; C7, RN_PLA_006): as faixas são parâmetros do exercício.
// Mesma forma do ProvedorSemaforo do orc, que o recebe por injeção (deps.semaforo). As faixas exigem
// cad.parametros:consultar (ErroPermissao sem ela; o orc confere antes e mostra o aviso).
export type ProvedorSemaforoCad = {
  faixas(ctx: ContextoRequisicao, ano: number): Promise<FaixasSemaforo | null>;
  classificar(uso: Percentual | null, faixas: FaixasSemaforo): FaixaSemaforo | null;
};

export function criarProvedorSemaforo(deps: { cliente?: PrismaClient } = {}): ProvedorSemaforoCad {
  return {
    faixas: async (ctx, ano) => (await obterParametrosExercicio(ctx, ano, deps))?.semaforo ?? null,
    classificar: classificarSemaforo,
  };
}

export const provedorSemaforo: ProvedorSemaforoCad = criarProvedorSemaforo();
