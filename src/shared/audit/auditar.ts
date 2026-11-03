import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import type { TxCliente } from '@/shared/db';
import { ErroDominio } from '@/shared/kernel';
import { calcularDelta } from './delta';
import { descrever } from './descricao';
import { serializarParaAuditoria } from './serializar';
import { ORIGENS_OPERACAO, TIPOS_OPERACAO, type EventoAuditoria, type TipoOperacao } from './tipos';

const textoObrigatorio = (mensagem: string) => z.string().trim().min(1, mensagem);

// Dados exigidos por tipo (Log Delta compulsório, spec §5): sem eles a linha seria gravada
// sem o rastro que a regra pede.
const EXIGE: Partial<Record<TipoOperacao, readonly ('antes' | 'depois')[]>> = {
  INSERCAO: ['depois'],
  ALTERACAO: ['antes', 'depois'],
  EXCLUSAO: ['antes'],
};

const esquema = z
  .object({
    contexto: z.object({
      usuarioId: z.uuid('usuário deve ser UUID').nullable(),
      usuarioRotulo: textoObrigatorio('usuário obrigatório'),
      sessaoUid: z.string().min(1, 'sessão vazia').nullable(),
      // Um IP só: o X-Forwarded-For com vários saltos é resolvido antes, no proxy.
      ip: z.union([z.ipv4(), z.ipv6()], 'IP inválido').nullable(),
      unidadeId: z.uuid('unidade deve ser UUID').nullable().optional(),
    }),
    funcionalidade: textoObrigatorio('funcionalidade obrigatória'),
    tipo: z.enum(TIPOS_OPERACAO),
    registroId: textoObrigatorio('registro vazio').optional(),
    descricao: textoObrigatorio('descrição vazia').optional(),
    antes: z.unknown().optional(),
    depois: z.unknown().optional(),
    origem: z.enum(ORIGENS_OPERACAO).optional(),
  })
  .superRefine((e, ctx) => {
    const exigidos = EXIGE[e.tipo];
    if (!exigidos) return;
    if (e.registroId === undefined) {
      ctx.addIssue({ code: 'custom', path: ['registroId'], message: `obrigatório em ${e.tipo}` });
    }
    for (const campo of exigidos) {
      if (e[campo] === undefined || e[campo] === null) {
        ctx.addIssue({ code: 'custom', path: [campo], message: `obrigatório em ${e.tipo}` });
      }
    }
  });

function json(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue);
}

// Grava o evento no Histórico de Operações usando a transação da própria operação (US-006):
// se a auditoria falhar, a operação inteira é desfeita.
export async function auditar(tx: TxCliente, evento: EventoAuditoria): Promise<void> {
  // O cliente raiz do Prisma também satisfaz TxCliente. O cliente de $transaction não expõe
  // $connect (itxClientDenyList do Prisma 7): é por aí que se distingue um do outro.
  if (typeof (tx as { $connect?: unknown }).$connect === 'function') {
    throw new ErroDominio('AUDITORIA_FORA_DA_TRANSACAO', 'auditar precisa da transação da operação (tx de $transaction)');
  }
  const validado = esquema.safeParse(evento);
  if (!validado.success) {
    throw new ErroDominio('AUDITORIA_INVALIDA', 'Evento de auditoria inválido', {
      problemas: validado.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
  }
  const { contexto, funcionalidade, tipo, registroId, origem } = validado.data;
  const antes = serializarParaAuditoria(evento.antes);
  const depois = serializarParaAuditoria(evento.depois);
  const temDados = antes !== undefined || depois !== undefined;

  await tx.historicoOperacao.create({
    data: {
      unidadeId: contexto.unidadeId ?? null,
      usuarioId: contexto.usuarioId,
      usuarioRotulo: contexto.usuarioRotulo,
      sessaoUid: contexto.sessaoUid,
      ip: contexto.ip,
      funcionalidade,
      tipoOperacao: tipo,
      registroId: registroId ?? null,
      descricao: validado.data.descricao ?? descrever(tipo, funcionalidade, registroId),
      antes: json(antes),
      depois: json(depois),
      delta: temDados ? json(calcularDelta(antes, depois)) : Prisma.DbNull,
      origem: origem ?? 'USUARIO',
    },
  });
}
