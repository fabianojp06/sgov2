import { cache } from 'react';
import { auditar, type EventoAuditoria } from '@/shared/audit';
import { prisma } from '@/shared/db';
import type { ContextoRequisicao, MotivoAusenciaSessao, ProvedorContexto } from './tipos';

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
  // O módulo do aut pode ser avaliado em mais de uma camada do Next: registrar de novo o
  // mesmo provedor é inofensivo; trocar por outro é recusado.
  const mesmo = estado.provedor === p || (p.id !== undefined && estado.provedor?.id === p.id);
  if (estado.configurado && mesmo) {
    estado.provedor = p;
    return;
  }
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

// Um render do RSC chama o provedor no layout, na página e na tela principal: o cache do React junta
// essas chamadas numa só por render (ressalva 4 do P5, #280). Fora de um render (Server Action, rota,
// testes), o cache do React só repassa a chamada: a ação que troca a senha ou sai não reaproveita um
// contexto antigo, e o render que vem depois dela é outro, com os cookies novos.
export const obterContexto = cache(obterContextoSemCache);

// Sem provedor, ninguém está autenticado (401). Fora dos testes, avisa no log uma vez:
// um aut que esqueceu de registrar o provedor deixaria todos em "Sessão expirada" sem pista.
async function obterContextoSemCache(): Promise<ContextoRequisicao | null> {
  if (!estado.provedor) {
    if (!estado.avisouSemProvedor && process.env.NODE_ENV !== 'test') {
      estado.avisouSemProvedor = true;
      console.error('[AUTHZ_SEM_PROVEDOR] ProvedorContexto não configurado: todas as requisições recebem 401');
    }
    return null;
  }
  return estado.provedor.obter();
}

// Motivo da falta de sessão (US-028), consultado só quando obterContexto devolve null. O cache junta
// a leitura do layout e a da página no mesmo render.
export const obterMotivoAusencia = cache(async (): Promise<MotivoAusenciaSessao | null> => (await estado.provedor?.motivoAusencia?.()) ?? null);

export function auditarNegacao(evento: EventoAuditoria): Promise<void> {
  return estado.auditor(evento);
}
