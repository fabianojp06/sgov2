'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { definirAcao } from '@/shared/authz';
import { ENCARGOS } from '../domain/parametros';
import { alterarParametrosExercicio, alterarSalarioMinimo } from './parametros';

// Server Actions dos parâmetros do exercício e do salário mínimo (US-053 parte 2). A negação (403) é
// auditada pela definirAcao (C5). Os campos de origem blindada passam pelo schema só para o caso de
// uso recusá-los e auditar a violação (M4/M-n4); o .strict() recusa qualquer outro campo a mais.
const blindado = z.unknown().optional();
const texto = (max: number, mensagem: string) => z.string().max(max, mensagem);
const pct = texto(20, 'Informe um percentual com até 4 casas decimais.');
const conta = texto(40, 'Conta inválida.');
const ano = z.number().int();
const versao = z.number().int();

const entradaParametros = z
  .object({
    ano,
    versao,
    reajuste: pct,
    mesDataBase: z.number().int(),
    ipca: pct,
    diasUteisMes: z.number().int(),
    semaforo: z.object({ verdeAte: pct, amareloAte: pct, laranjaAte: pct }).strict(),
    encargos: z.array(z.object({ componente: z.enum(ENCARGOS), percentual: pct, conta, provisorio: blindado, nome: blindado }).strict()).max(10),
    contas: z.object({ salario: conta, adicional: conta, ferias: conta, decimo_terceiro: conta, provisorio: blindado }).strict(),
    provisorio: blindado,
    congeladoEm: blindado,
    congelado: blindado,
    atualizadoEm: blindado,
  })
  .strict();

export const acaoAlterarParametros = definirAcao({ funcionalidade: 'cad.parametros', acao: 'alterar', entrada: entradaParametros }, async (e, ctx) => {
  const { ano: a, versao: v, ...dados } = e;
  const r = await alterarParametrosExercicio(ctx, a, v, dados);
  if (r.ok) revalidatePath('/cad/parametros');
  return r;
});

export const acaoAlterarSalarioMinimo = definirAcao(
  { funcionalidade: 'cad.salario_minimo', acao: 'alterar', entrada: z.object({ ano, versao, valor: texto(30, 'Informe o valor com até 2 casas decimais.') }).strict() },
  async (e, ctx) => {
    const r = await alterarSalarioMinimo(ctx, e.ano, e.versao, e.valor);
    if (r.ok) revalidatePath('/cad/salario-minimo');
    return r;
  },
);
