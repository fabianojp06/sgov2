import { z } from 'zod';
import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma } from '@/shared/db';
import { ESFORCOS_IA, inicioDoMes, MINUTOS_RESERVA, MODELOS_IA, type EsforcoIA } from '@/shared/ia';
import { ConflitoConcorrencia, ErroDominio, exigirUmaLinha, falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { inteiroEntre, lerDolar } from '../domain/valores';

// Cadastro da IA (US-019 parte 2, spec §4.4): a chave geral (ia.habilitada), o limite por minuto, o
// teto global e, por caso de uso, ativo, modelo, esforço, max_tokens e teto; com o consumo do mês e o
// aviso de teto atingido. Os casos são instalados pelas seeds dos módulos (inativos): aqui só se
// configura. Cada alteração confere a versão lida pela tela e vai ao Histórico na mesma transação.

export const FUNCIONALIDADE_IA = 'int.ia';

type Deps = { cliente?: PrismaClient; agora?: () => Date };

export type ConsumoIA = { gastoMesUsd: string; chamadasMes: number; errosMes: number; tetoAtingido: boolean };

export type CasoUsoTela = ConsumoIA & {
  codigo: string;
  nome: string;
  funcionalidade: string;
  versaoInstrucao: number;
  guardarTexto: boolean;
  versao: number;
  ativo: boolean;
  modelo: string;
  esforco: string;
  maxTokens: number;
  tetoMensalUsd: string;
};

export type TelaIA = {
  /** Mês do consumo, "11/2026" (America/Sao_Paulo). */
  mes: string;
  configuracao: ConsumoIA & { versao: number; habilitada: boolean; limitePorMinuto: number; tetoMensalUsd: string };
  casos: CasoUsoTela[];
  modelos: readonly string[];
  esforcos: readonly EsforcoIA[];
};

export async function obterTelaIA(ctx: ContextoRequisicao, deps: Deps = {}): Promise<TelaIA> {
  exigir(ctx, FUNCIONALIDADE_IA, 'consultar');
  const cliente = deps.cliente ?? prisma;
  const momento = (deps.agora ?? (() => new Date()))();
  const desde = inicioDoMes(momento);
  const [config, casos, porCaso, errosPorCaso, reservas] = await Promise.all([
    cliente.iaConfiguracao.findUniqueOrThrow({ where: { id: 1 } }),
    cliente.iaCasoUso.findMany({ orderBy: { codigo: 'asc' } }),
    cliente.iaChamada.groupBy({ by: ['casoUsoCodigo'], where: { criadoEm: { gte: desde } }, _sum: { custoEstimadoUsd: true }, _count: { _all: true } }),
    cliente.iaChamada.groupBy({ by: ['casoUsoCodigo'], where: { criadoEm: { gte: desde }, erro: { not: null } }, _count: { _all: true } }),
    // As reservas abertas contam no teto como na governança (chamadas em curso).
    cliente.iaReserva.groupBy({
      by: ['casoUsoCodigo'],
      where: { criadoEm: { gt: new Date(momento.getTime() - MINUTOS_RESERVA * 60_000) } },
      _sum: { custoMaximoUsd: true },
    }),
  ]);
  const gastos = new Map(porCaso.map((g) => [g.casoUsoCodigo, g]));
  const erros = new Map(errosPorCaso.map((g) => [g.casoUsoCodigo, g._count._all]));
  type Dec = Prisma.Decimal;
  const ZERO = new Prisma.Decimal(0);
  const emCurso = new Map(reservas.map((r) => [r.casoUsoCodigo, r._sum.custoMaximoUsd ?? ZERO]));
  // A mesma regra da governança: gasto do mês mais as reservas abertas, contra o teto.
  const atingido = (gasto: Dec | null | undefined, reservado: Dec, teto: Dec) => !teto.isZero() && (gasto ?? ZERO).plus(reservado).gte(teto);
  const somaGlobal = porCaso.reduce((s, g) => (g._sum.custoEstimadoUsd ? s.plus(g._sum.custoEstimadoUsd) : s), ZERO);
  const reservadoGlobal = [...emCurso.values()].reduce((s, r) => s.plus(r), ZERO);
  // Exibição: 2 casas, arredondando para cima (o gasto nunca aparece menor que o real).
  const usd = (v: Dec | null | undefined) => (v ? v.toDecimalPlaces(2, Prisma.Decimal.ROUND_UP).toFixed(2) : '0.00');
  const local = new Date(desde.getTime() - 3 * 3_600_000);
  return {
    mes: `${String(local.getUTCMonth() + 1).padStart(2, '0')}/${local.getUTCFullYear()}`,
    configuracao: {
      versao: config.versao,
      habilitada: config.habilitada,
      limitePorMinuto: config.limitePorMinuto,
      tetoMensalUsd: config.tetoMensalUsd.toFixed(2),
      gastoMesUsd: usd(somaGlobal),
      chamadasMes: porCaso.reduce((n, g) => n + g._count._all, 0),
      errosMes: [...erros.values()].reduce((n, e) => n + e, 0),
      tetoAtingido: atingido(somaGlobal, reservadoGlobal, config.tetoMensalUsd),
    },
    casos: casos.map((c) => {
      const g = gastos.get(c.codigo);
      return {
        codigo: c.codigo,
        nome: c.nome,
        funcionalidade: c.funcionalidade,
        versaoInstrucao: c.versaoInstrucao,
        guardarTexto: c.guardarTexto,
        versao: c.versao,
        ativo: c.ativo,
        modelo: c.modelo,
        esforco: c.esforco,
        maxTokens: c.maxTokens,
        tetoMensalUsd: c.tetoMensalUsd.toFixed(2),
        gastoMesUsd: usd(g?._sum.custoEstimadoUsd),
        chamadasMes: g?._count._all ?? 0,
        errosMes: erros.get(c.codigo) ?? 0,
        tetoAtingido: atingido(g?._sum.custoEstimadoUsd, emCurso.get(c.codigo) ?? ZERO, c.tetoMensalUsd),
      };
    }),
    modelos: MODELOS_IA,
    esforcos: ESFORCOS_IA,
  };
}

// Entrada do formulário: textos do FormData; a caixa de seleção marcada chega como "sim".
const versao = z.coerce.number().int().min(1).max(2_147_483_647);
const marcado = z.literal('sim').optional();
const esquemaConfiguracao = z.object({ versao, habilitada: marcado, limitePorMinuto: z.string(), tetoGlobalUsd: z.string() }).strict();
const esquemaCaso = z
  .object({ codigo: z.string().max(100), versao, ativo: marcado, modelo: z.string(), esforco: z.string(), maxTokens: z.string(), tetoMensalUsd: z.string() })
  .strict();

export const MSG_TETO = 'Informe o valor em dólares, com até 2 casas decimais (ex.: 150,00).';
export const MSG_LIMITE = 'Informe um número inteiro de 1 a 1.000.';
export const MSG_MAX_TOKENS = 'Informe um número inteiro de 1 a 128.000.';
const MSG_ENTRADA = 'Os dados enviados não são válidos. Recarregue a tela.';

const contextoDe = (ctx: ContextoRequisicao) => ({ usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip, unidadeId: null });

// ORIGEM BLINDADA (spec §5): o que vem do código (nome, permissão, instrução, guardarTexto) e o que é
// calculado (consumo) não se altera pela tela. A tentativa é auditada numa transação própria e vira
// erro de domínio; a operação não acontece.
const BLINDADOS_CONSUMO = ['gastoMesUsd', 'chamadasMes', 'errosMes', 'tetoAtingido', 'alteradoEm', 'id'];
const BLINDADOS_CASO = ['nome', 'funcionalidade', 'versaoInstrucao', 'guardarTexto', ...BLINDADOS_CONSUMO];
export const MSG_ORIGEM_BLINDADA = 'O pedido tem campos que não podem ser alterados pela tela.';

async function conferirOrigemBlindada(cliente: PrismaClient, ctx: ContextoRequisicao, bruto: unknown, blindados: readonly string[], registroId: string): Promise<void> {
  if (bruto === null || typeof bruto !== 'object') return;
  const campos = blindados.filter((c) => Object.hasOwn(bruto, c));
  if (campos.length === 0) return;
  await cliente.$transaction((tx) =>
    auditar(tx, {
      contexto: contextoDe(ctx),
      funcionalidade: FUNCIONALIDADE_IA,
      tipo: 'SISTEMA',
      registroId,
      descricao: 'int.violacao_governanca: campo de origem blindada no pedido',
      depois: { campos },
    }),
  );
  throw new ErroDominio('int.violacao_governanca', MSG_ORIGEM_BLINDADA, { campos });
}

export async function alterarConfiguracaoIA(ctx: ContextoRequisicao, bruto: unknown, deps: Deps = {}): Promise<Resultado<{ versao: number }>> {
  exigir(ctx, FUNCIONALIDADE_IA, 'alterar');
  const cliente = deps.cliente ?? prisma;
  await conferirOrigemBlindada(cliente, ctx, bruto, BLINDADOS_CONSUMO, 'configuracao');
  const e = esquemaConfiguracao.safeParse(bruto);
  if (!e.success) return falha([{ campo: '', mensagem: MSG_ENTRADA }]);
  const limite = inteiroEntre(e.data.limitePorMinuto, 1, 1000);
  const teto = lerDolar(e.data.tetoGlobalUsd);
  const erros: ErroCampo[] = [];
  if (limite === null) erros.push({ campo: 'limitePorMinuto', mensagem: MSG_LIMITE });
  if (teto === null) erros.push({ campo: 'tetoGlobalUsd', mensagem: MSG_TETO });
  if (limite === null || teto === null) return falha(erros);
  const depois = { habilitada: e.data.habilitada === 'sim', limitePorMinuto: limite, tetoMensalUsd: teto };
  return cliente.$transaction(async (tx) => {
    const a = await tx.iaConfiguracao.findUniqueOrThrow({ where: { id: 1 } });
    if (a.versao !== e.data.versao) throw new ConflitoConcorrencia();
    exigirUmaLinha(
      await tx.iaConfiguracao.updateMany({ where: { id: 1, versao: e.data.versao }, data: { ...depois, versao: { increment: 1 }, alteradoEm: new Date() } }),
    );
    await auditar(tx, {
      contexto: contextoDe(ctx),
      funcionalidade: FUNCIONALIDADE_IA,
      tipo: 'ALTERACAO',
      registroId: 'configuracao',
      descricao: depois.habilitada === a.habilitada ? 'Configuração geral da IA alterada' : `IA ${depois.habilitada ? 'ligada' : 'desligada'} (chave geral)`,
      antes: { habilitada: a.habilitada, limitePorMinuto: a.limitePorMinuto, tetoMensalUsd: a.tetoMensalUsd.toFixed(2) },
      depois,
    });
    return ok({ versao: e.data.versao + 1 });
  });
}

export async function alterarCasoUsoIA(ctx: ContextoRequisicao, bruto: unknown, deps: Deps = {}): Promise<Resultado<{ versao: number }>> {
  exigir(ctx, FUNCIONALIDADE_IA, 'alterar');
  const cliente = deps.cliente ?? prisma;
  const registro = bruto !== null && typeof bruto === 'object' && typeof (bruto as { codigo?: unknown }).codigo === 'string' ? String((bruto as { codigo: string }).codigo).slice(0, 100) : 'caso';
  await conferirOrigemBlindada(cliente, ctx, bruto, BLINDADOS_CASO, registro);
  const e = esquemaCaso.safeParse(bruto);
  if (!e.success) return falha([{ campo: '', mensagem: MSG_ENTRADA }]);
  const maxTokens = inteiroEntre(e.data.maxTokens, 1, 128_000);
  const teto = lerDolar(e.data.tetoMensalUsd);
  const erros: ErroCampo[] = [];
  if (!MODELOS_IA.includes(e.data.modelo)) erros.push({ campo: 'modelo', mensagem: 'Escolha um dos modelos da lista.' });
  if (!(ESFORCOS_IA as readonly string[]).includes(e.data.esforco)) erros.push({ campo: 'esforco', mensagem: 'Escolha um dos esforços da lista.' });
  if (maxTokens === null) erros.push({ campo: 'maxTokens', mensagem: MSG_MAX_TOKENS });
  if (teto === null) erros.push({ campo: 'tetoMensalUsd', mensagem: MSG_TETO });
  if (erros.length > 0 || maxTokens === null || teto === null) return falha(erros);
  const depois = { ativo: e.data.ativo === 'sim', modelo: e.data.modelo, esforco: e.data.esforco, maxTokens, tetoMensalUsd: teto };
  const codigo = e.data.codigo;
  return cliente.$transaction(async (tx) => {
    const a = await tx.iaCasoUso.findUnique({ where: { codigo } });
    if (!a) return falha([{ campo: '', mensagem: 'Caso de uso de IA não encontrado. Recarregue a tela.' }]);
    if (a.versao !== e.data.versao) throw new ConflitoConcorrencia();
    exigirUmaLinha(await tx.iaCasoUso.updateMany({ where: { codigo, versao: e.data.versao }, data: { ...depois, versao: { increment: 1 } } }));
    await auditar(tx, {
      contexto: contextoDe(ctx),
      funcionalidade: FUNCIONALIDADE_IA,
      tipo: 'ALTERACAO',
      registroId: codigo,
      descricao: depois.ativo === a.ativo ? `Caso de uso de IA ${codigo} alterado` : `Caso de uso de IA ${codigo} ${depois.ativo ? 'ligado' : 'desligado'}`,
      antes: { ativo: a.ativo, modelo: a.modelo, esforco: a.esforco, maxTokens: a.maxTokens, tetoMensalUsd: a.tetoMensalUsd.toFixed(2) },
      depois,
    });
    return ok({ versao: e.data.versao + 1 });
  });
}
