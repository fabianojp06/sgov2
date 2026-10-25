import { auditar, type EventoAuditoria } from '@/shared/audit';
import { prisma } from '@/shared/db';
import type { ContextoRequisicao, ProvedorContexto } from './tipos';

export type AuditorNegacao = (evento: EventoAuditoria) => Promise<void>;

type Estado = {
  provedor: ProvedorContexto | null;
  auditor: AuditorNegacao;
  configurado: boolean;
  avisouSemProvedor: boolean;
};

// Estado no globalThis: o Next pode carregar este módulo em mais de uma camada (rsc, ssr,
// instrumentation), e a configuração feita numa precisa valer nas outras.
const CHAVE = Symbol.for('sgo.authz');
const global_ = globalThis as typeof globalThis & { [CHAVE]?: Estado };
const estado: Estado = (global_[CHAVE] ??= {
  provedor: null,
  // A negação não tem operação de negócio: grava numa transação própria.
  auditor: (evento) => prisma.$transaction((tx) => auditar(tx, evento)),
  configurado: false,
  avisouSemProvedor: false,
});

// Em produção, o provedor é configurado uma única vez (pelo módulo aut, no P5): trocá-lo
// depois desligaria a autorização. Nos testes, a troca é livre.
export function configurarProvedorContexto(p: ProvedorContexto): void {
  if (estado.configurado && process.env.NODE_ENV === 'production') {
    throw new Error('ProvedorContexto já configurado: a autorização não pode ser trocada em produção');
  }
  estado.provedor = p;
  estado.configurado = true;
}

export function configurarAuditorNegacao(fn: AuditorNegacao): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('O auditor de negação só pode ser trocado em teste');
  }
  estado.auditor = fn;
}

// Sem provedor, ninguém está autenticado (401). Fora dos testes, avisa no log uma vez:
// um aut que esqueceu de registrar o provedor deixaria todos em "Sessão expirada" sem pista.
export async function obterContexto(): Promise<ContextoRequisicao | null> {
  if (!estado.provedor) {
    if (!estado.avisouSemProvedor && process.env.NODE_ENV !== 'test') {
      estado.avisouSemProvedor = true;
      console.error('[AUTHZ_SEM_PROVEDOR] ProvedorContexto não configurado: todas as requisições recebem 401');
    }
    return null;
  }
  return estado.provedor.obter();
}

export function auditarNegacao(evento: EventoAuditoria): Promise<void> {
  return estado.auditor(evento);
}
