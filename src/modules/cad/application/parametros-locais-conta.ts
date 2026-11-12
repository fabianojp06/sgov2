import type { PrismaClient } from '@/generated/prisma/client';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma, type TxCliente } from '@/shared/db';
import { falha, ok, type Resultado } from '@/shared/kernel';
import { validarParametroLocal, type EntradaParametroLocal, type NaturezaConta } from '../domain/parametro-local-conta';
import { MSG_CONCORRENCIA } from '../infrastructure/parametro-sistema';

// Parâmetros locais da conta analítica (US-045; RF_PLA_REQ_003, C7, C27). Consulta com
// cad.plano_contas:consultar; a alteração é parametrização local da tela do plano de contas, com
// cad.plano_contas:executar (C27: a tela não altera a estrutura, só sincroniza, importa e parametriza).

type Deps = { cliente?: PrismaClient };

const contextoDe = (ctx: ContextoRequisicao) => ({
  usuarioId: ctx.usuarioId,
  usuarioRotulo: ctx.usuarioRotulo,
  sessaoUid: ctx.sessaoUid,
  ip: ctx.ip,
  unidadeId: null,
});

type Decimal = { toFixed(n: number): string } | null;
// 70.0000 → 70; 80.5000 → 80.5 (só para a tela e o Histórico).
const curto = (s: string) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s);
const texto = (d: Decimal) => (d === null ? null : curto(d.toFixed(4)));

export type ParametroLocalTela = Readonly<{
  contaId: string;
  classificacao: string;
  descricao: string;
  natureza: NaturezaConta | null;
  /** Faixas próprias em pontos percentuais (texto), ou null: valem as do exercício. */
  semaforo: Readonly<{ verdeAte: string; amareloAte: string; laranjaAte: string }> | null;
  /** 0: ainda sem parâmetro local. */
  versao: number;
}>;

type Faixas = Readonly<{ verdeAte: string; amareloAte: string; laranjaAte: string }>;
export type TelaParametrosLocais = Readonly<{
  contas: readonly ParametroLocalTela[];
  /** As faixas do exercício mais recente (o padrão de quem não tem faixas próprias), ou null sem exercício. */
  faixasExercicio: Faixas | null;
}>;

/** Contas analíticas ativas, em ordem de classificação, com os parâmetros locais e as faixas do exercício mais recente. */
export async function obterTelaParametrosLocais(ctx: ContextoRequisicao, deps: Deps = {}): Promise<TelaParametrosLocais> {
  exigir(ctx, 'cad.plano_contas', 'consultar');
  const cliente = deps.cliente ?? prisma;
  const ex = await cliente.parametrosExercicio.findFirst({
    orderBy: { ano: 'desc' },
    select: { semaforoVerdeAte: true, semaforoAmareloAte: true, semaforoLaranjaAte: true },
  });
  const faixasExercicio = ex
    ? { verdeAte: texto(ex.semaforoVerdeAte)!, amareloAte: texto(ex.semaforoAmareloAte)!, laranjaAte: texto(ex.semaforoLaranjaAte)! }
    : null;
  return { contas: await listarContas(cliente), faixasExercicio };
}

async function listarContas(cliente: PrismaClient): Promise<readonly ParametroLocalTela[]> {
  const contas = await cliente.contaContabil.findMany({
    where: { tipo: 'ANALITICA', ativa: true },
    orderBy: { classificacao: 'asc' },
    select: { id: true, classificacao: true, descricao: true, parametroLocal: true },
  });
  return contas.map((c) => {
    const p = c.parametroLocal;
    const semaforo =
      p && p.semaforoVerdeAte !== null && p.semaforoAmareloAte !== null && p.semaforoLaranjaAte !== null
        ? { verdeAte: texto(p.semaforoVerdeAte)!, amareloAte: texto(p.semaforoAmareloAte)!, laranjaAte: texto(p.semaforoLaranjaAte)! }
        : null;
    return { contaId: c.id, classificacao: c.classificacao, descricao: c.descricao, natureza: p?.natureza ?? null, semaforo, versao: p?.versao ?? 0 };
  });
}

/**
 * Grava os parâmetros locais da conta (cad.plano_contas:executar). `versao` 0 inclui; senão, altera
 * só se a versão gravada for a mesma (escrita concorrente é recusada). Devolve a versão nova.
 */
export async function alterarParametroLocal(
  ctx: ContextoRequisicao,
  contaId: string,
  versao: number,
  dados: EntradaParametroLocal,
  deps: Deps = {},
): Promise<Resultado<{ versao: number }>> {
  exigir(ctx, 'cad.plano_contas', 'executar');
  if (!/^[0-9a-f-]{36}$/i.test(contaId) || !Number.isInteger(versao) || versao < 0) {
    return falha([{ campo: '_', mensagem: 'Conta ou versão inválidas. Recarregue a tela.' }]);
  }
  const v = validarParametroLocal(dados);
  if (!v.ok) return v;
  const valores = {
    natureza: v.valor.natureza,
    semaforoVerdeAte: v.valor.semaforo?.verdeAte.paraString() ?? null,
    semaforoAmareloAte: v.valor.semaforo?.amareloAte.paraString() ?? null,
    semaforoLaranjaAte: v.valor.semaforo?.laranjaAte.paraString() ?? null,
  };
  const cliente = deps.cliente ?? prisma;
  return cliente.$transaction(async (tx: TxCliente) => {
    const conta = await tx.contaContabil.findUnique({
      where: { id: contaId },
      select: { classificacao: true, tipo: true, ativa: true, parametroLocal: true },
    });
    if (!conta || conta.tipo !== 'ANALITICA' || !conta.ativa) {
      return falha([{ campo: '_', mensagem: 'Parâmetros locais só em conta analítica ativa. Recarregue a tela.' }]);
    }
    const antes = conta.parametroLocal;
    if ((antes?.versao ?? 0) !== versao) return falha([{ campo: '_', mensagem: MSG_CONCORRENCIA }]);
    if (antes) {
      const r = await tx.contaParametroLocal.updateMany({
        where: { contaId, versao },
        data: { ...valores, versao: { increment: 1 }, atualizadoEm: new Date() },
      });
      if (r.count === 0) return falha([{ campo: '_', mensagem: MSG_CONCORRENCIA }]);
    } else {
      // Inclusão concorrente: a segunda bate na chave primária e vira o mesmo aviso de concorrência.
      const criado = await tx.$queryRaw<{ conta_id: string }[]>`INSERT INTO "conta_parametro_local"
        ("conta_id", "natureza", "semaforo_verde_ate", "semaforo_amarelo_ate", "semaforo_laranja_ate")
        VALUES (${contaId}::uuid, ${valores.natureza}::"NaturezaConta", ${valores.semaforoVerdeAte}::numeric,
          ${valores.semaforoAmareloAte}::numeric, ${valores.semaforoLaranjaAte}::numeric)
        ON CONFLICT ("conta_id") DO NOTHING RETURNING "conta_id"`;
      if (criado.length === 0) return falha([{ campo: '_', mensagem: MSG_CONCORRENCIA }]);
    }
    await auditar(tx, {
      contexto: contextoDe(ctx),
      funcionalidade: 'cad.plano_contas',
      tipo: antes ? 'ALTERACAO' : 'INSERCAO',
      registroId: conta.classificacao,
      descricao: `Parâmetros locais da conta ${conta.classificacao} ${antes ? 'alterados' : 'definidos'}`,
      antes: antes
        ? {
            natureza: antes.natureza,
            semaforo: antes.semaforoVerdeAte === null ? null : [texto(antes.semaforoVerdeAte), texto(antes.semaforoAmareloAte), texto(antes.semaforoLaranjaAte)],
          }
        : null,
      depois: {
        natureza: valores.natureza,
        semaforo: v.valor.semaforo
          ? [curto(v.valor.semaforo.verdeAte.paraString()), curto(v.valor.semaforo.amareloAte.paraString()), curto(v.valor.semaforo.laranjaAte.paraString())]
          : null,
      },
    });
    return ok({ versao: versao + 1 });
  });
}
