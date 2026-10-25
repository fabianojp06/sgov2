import { auditar, type EventoAuditoria } from '@/shared/audit';
import { prisma } from '@/shared/db';
import type { ContextoRequisicao, ProvedorContexto } from './tipos';

// O módulo aut registra o provedor real no P5. Até lá, ninguém está autenticado (401).
let provedor: ProvedorContexto = { obter: async () => null };

export function configurarProvedorContexto(p: ProvedorContexto): void {
  provedor = p;
}

export function obterContexto(): Promise<ContextoRequisicao | null> {
  return provedor.obter();
}

export type AuditorNegacao = (evento: EventoAuditoria) => Promise<void>;

// A negação não tem operação de negócio: grava numa transação própria.
let auditorNegacao: AuditorNegacao = (evento) => prisma.$transaction((tx) => auditar(tx, evento));

export function configurarAuditorNegacao(fn: AuditorNegacao): void {
  auditorNegacao = fn;
}

export function auditarNegacao(evento: EventoAuditoria): Promise<void> {
  return auditorNegacao(evento);
}
