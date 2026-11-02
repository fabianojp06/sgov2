'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { definirAcao } from '@/shared/authz';
import { falha, type ErroCampo } from '@/shared/kernel';
import { ENCARGOS } from '../domain/parametros';
import { alterarParametrosExercicio, alterarSalarioMinimo, conferirOrigemBlindada } from './parametros';

// Server Actions dos parâmetros do exercício e do salário mínimo (US-053 parte 2). A negação (403) é
// auditada pela definirAcao (C5). A entrada chega bruta (z.unknown) para a origem blindada ser
// conferida e auditada antes do parse (M4/M-n4); só depois vem o schema .strict(), em português.
const PORTUGUES = z.locales.pt().localeError;
const texto = (max: number, mensagem: string) => z.string().max(max, mensagem);
const pct = texto(20, 'Informe um percentual com até 4 casas decimais.');
const conta = texto(40, 'Conta inválida.');
const ano = z.number().int();
const versao = z.number().int();

const esquemaParametros = z
  .object({
    ano,
    versao,
    reajuste: pct,
    mesDataBase: z.number().int(),
    ipca: pct,
    diasUteisMes: z.number().int(),
    semaforo: z.object({ verdeAte: pct, amareloAte: pct, laranjaAte: pct }).strict(),
    encargos: z.array(z.object({ componente: z.enum(ENCARGOS), percentual: pct, conta }).strict()).max(10),
    contas: z.object({ salario: conta, adicional: conta, ferias: conta, decimo_terceiro: conta }).strict(),
  })
  .strict();

const esquemaSalarioMinimo = z.object({ ano, versao, valor: texto(30, 'Informe o valor com até 2 casas decimais.') }).strict();

const errosDo = (e: z.ZodError): ErroCampo[] => e.issues.map((i) => ({ campo: i.path.length > 0 ? i.path.join('.') : '_', mensagem: i.message }));

export const acaoAlterarParametros = definirAcao({ funcionalidade: 'cad.parametros', acao: 'alterar', entrada: z.unknown() }, async (bruto, ctx) => {
  await conferirOrigemBlindada(ctx, 'cad.parametros', bruto);
  const e = esquemaParametros.safeParse(bruto, { error: PORTUGUES });
  if (!e.success) return falha(errosDo(e.error));
  const { ano: a, versao: v, ...dados } = e.data;
  const r = await alterarParametrosExercicio(ctx, a, v, dados);
  if (r.ok) revalidatePath('/cad/parametros');
  return r;
});

export const acaoAlterarSalarioMinimo = definirAcao({ funcionalidade: 'cad.salario_minimo', acao: 'alterar', entrada: z.unknown() }, async (bruto, ctx) => {
  await conferirOrigemBlindada(ctx, 'cad.salario_minimo', bruto);
  const e = esquemaSalarioMinimo.safeParse(bruto, { error: PORTUGUES });
  if (!e.success) return falha(errosDo(e.error));
  const r = await alterarSalarioMinimo(ctx, e.data.ano, e.data.versao, e.data.valor);
  // A versão do ano é uma só (R10): a tela de parâmetros também precisa da nova.
  if (r.ok) {
    revalidatePath('/cad/salario-minimo');
    revalidatePath('/cad/parametros');
  }
  return r;
});
