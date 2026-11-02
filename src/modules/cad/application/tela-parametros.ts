import 'server-only';
import type { PrismaClient } from '@/generated/prisma/client';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma } from '@/shared/db';
import type { NoConta } from '../domain/estrutura';
import { paraTela, type OpcaoConta, type ParametrosTela } from '../domain/parametros-tela';
import { listarArvoreContas } from '../infrastructure/estrutura-financeira';
import { lerParametrosExercicio } from '../infrastructure/parametro-sistema';

// Dados das telas de parâmetros do exercício e do salário mínimo (US-053 parte 2; plano do P4,
// Task 9b), já serializáveis. Cada uma confere a permissão de consultar antes de ler.

type Deps = { cliente?: PrismaClient };

const anoValido = (ano: number | null): ano is number => ano !== null && Number.isInteger(ano) && ano >= 2000 && ano <= 2099;

async function anosComParametros(cliente: PrismaClient): Promise<number[]> {
  return (await cliente.parametrosExercicio.findMany({ select: { ano: true }, orderBy: { ano: 'desc' } })).map((p) => p.ano);
}

/** Exercício pedido (se válido) ou o mais recente com parâmetros. */
const escolherAno = (pedido: number | null, anos: readonly number[]): number | null => (anoValido(pedido) ? pedido : (anos[0] ?? null));

const analiticas = (nos: readonly NoConta[]): OpcaoConta[] =>
  nos.flatMap((n) => [...(n.tipo === 'ANALITICA' ? [{ classificacao: n.classificacao, descricao: n.descricao }] : []), ...analiticas(n.filhos)]);

export type TelaParametros = { anos: readonly number[]; ano: number | null; parametros: ParametrosTela | null; contas: readonly OpcaoConta[] };

export async function obterTelaParametros(ctx: ContextoRequisicao, anoPedido: number | null, deps: Deps = {}): Promise<TelaParametros> {
  exigir(ctx, 'cad.parametros', 'consultar');
  const cliente = deps.cliente ?? prisma;
  const anos = await anosComParametros(cliente);
  const ano = escolherAno(anoPedido, anos);
  const p = ano === null ? null : await lerParametrosExercicio(cliente, ano);
  // Só as analíticas ativas recebem componente (C1); a árvore padrão já vem sem as inativas.
  return { anos, ano, parametros: p ? paraTela(p) : null, contas: analiticas(await listarArvoreContas(cliente)) };
}

export type TelaSalarioMinimo = {
  anos: readonly number[];
  ano: number | null;
  dados: { ano: number; versao: number; congelado: boolean; valor: string | null } | null;
};

export async function obterTelaSalarioMinimo(ctx: ContextoRequisicao, anoPedido: number | null, deps: Deps = {}): Promise<TelaSalarioMinimo> {
  exigir(ctx, 'cad.salario_minimo', 'consultar');
  const cliente = deps.cliente ?? prisma;
  const anos = await anosComParametros(cliente);
  const ano = escolherAno(anoPedido, anos);
  const p =
    ano === null
      ? null
      : await cliente.parametrosExercicio.findUnique({ where: { ano }, select: { ano: true, versao: true, congeladoEm: true, salarioMinimo: true } });
  return {
    anos,
    ano,
    dados: p ? { ano: p.ano, versao: p.versao, congelado: p.congeladoEm !== null, valor: p.salarioMinimo === null ? null : p.salarioMinimo.toFixed(2) } : null,
  };
}
