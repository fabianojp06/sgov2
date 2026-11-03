'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { definirAcao } from '@/shared/authz';
import { falha, type ErroCampo } from '@/shared/kernel';
import { FONTES_ATIVAS, GRAUS_INSALUBRIDADE } from '../domain/cargo';
import { consultarCargaDoGrupo, entradaArquivoCarga, entradaConsultaCarga } from './acao-carga';
import { alterarCargo, conferirOrigemBlindadaCargo, regravarCifraSalarios } from './cargos';
import { solicitarCargaCargos } from './importar-estrutura';

// Server Actions dos cargos (US-049 parte 2). A negação (403) é auditada pela definirAcao (C5). A
// alteração chega bruta (z.unknown) para a origem blindada ser conferida e auditada antes do parse
// (M4/M-n4); depois vem o schema .strict(), em português.
const PORTUGUES = z.locales.ptBR().localeError;
const dinheiro = z.string().max(30, 'Informe o valor com até 2 casas decimais.').nullable();

const esquemaAlterar = z
  .object({
    idCargo: z.string().max(36),
    versao: z.number().int(),
    mercadoMinimo: dinheiro,
    mercadoMaximo: dinheiro,
    periculosidade: z.boolean(),
    insalubridade: z.enum(GRAUS_INSALUBRIDADE).nullable(),
    fonteAtiva: z.enum(FONTES_ATIVAS).nullable(),
    funcaoGratificada: dinheiro.optional(),
    salarioDefinido: dinheiro.optional(),
  })
  .strict();

const errosDo = (e: z.ZodError): ErroCampo[] => e.issues.map((i) => ({ campo: i.path.length > 0 ? i.path.join('.') : '_', mensagem: i.message }));

export const acaoAlterarCargo = definirAcao({ funcionalidade: 'cad.cargos', acao: 'alterar', entrada: z.unknown() }, async (bruto, ctx) => {
  await conferirOrigemBlindadaCargo(ctx, bruto);
  const e = esquemaAlterar.safeParse(bruto, { error: PORTUGUES });
  if (!e.success) return falha(errosDo(e.error));
  const { idCargo, versao, ...dados } = e.data;
  const r = await alterarCargo(ctx, idCargo, versao, dados);
  if (r.ok) revalidatePath('/cad/cargos');
  return r;
});

export const acaoImportarCargos = definirAcao({ funcionalidade: 'cad.cargos', acao: 'executar', entrada: entradaArquivoCarga }, (e, ctx) =>
  solicitarCargaCargos(ctx, e.arquivo),
);

// M-n1: só devolve lote do grupo dos cargos (CARGOS e CARGOS_RECIFRA).
export const acaoConsultarCargaCargos = definirAcao(
  { funcionalidade: 'cad.cargos', acao: 'executar', entrada: entradaConsultaCarga },
  (e, ctx) => consultarCargaDoGrupo(ctx, e.cargaId, 'CARGOS'),
);

export const acaoRegravarSalarios = definirAcao({ funcionalidade: 'cad.cargos', acao: 'executar', entrada: z.object({}).strict() }, async (_e, ctx) => {
  const r = await regravarCifraSalarios(ctx);
  if (r.ok) revalidatePath('/cad/cargos');
  return r;
});
