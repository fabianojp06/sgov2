import type { PrismaClient } from '@/generated/prisma/client';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma } from '@/shared/db';
import { Percentual } from '@/shared/kernel';
import { classificarSemaforo, type FaixaSemaforo, type FaixasSemaforo } from '../domain/semaforo';

// Semáforo do uso do teto para o orc (#234; C7, RN_PLA_006): as faixas são parâmetros do exercício.
// Mesma forma do ProvedorSemaforo do orc, que o recebe por injeção (deps.semaforo). As faixas exigem
// cad.parametros:consultar (ErroPermissao sem ela; o orc confere antes e mostra o aviso).
export type ProvedorSemaforoCad = {
  faixas(ctx: ContextoRequisicao, ano: number): Promise<FaixasSemaforo | null>;
  classificar(uso: Percentual | null, faixas: FaixasSemaforo): FaixaSemaforo | null;
};

export function criarProvedorSemaforo(deps: { cliente?: PrismaClient } = {}): ProvedorSemaforoCad {
  return {
    // Só as três colunas: um parâmetro incompleto do ano não derruba o painel do orc.
    faixas: async (ctx, ano) => {
      exigir(ctx, 'cad.parametros', 'consultar');
      if (!Number.isInteger(ano) || ano < 2000 || ano > 2099) return null;
      const p = await (deps.cliente ?? prisma).parametrosExercicio.findUnique({
        where: { ano },
        select: { semaforoVerdeAte: true, semaforoAmareloAte: true, semaforoLaranjaAte: true },
      });
      if (!p) return null;
      const pct = (d: { toString(): string }) => Percentual.dePontos(d.toString());
      return { verdeAte: pct(p.semaforoVerdeAte), amareloAte: pct(p.semaforoAmareloAte), laranjaAte: pct(p.semaforoLaranjaAte) };
    },
    classificar: classificarSemaforo,
  };
}

export const provedorSemaforo: ProvedorSemaforoCad = criarProvedorSemaforo();
