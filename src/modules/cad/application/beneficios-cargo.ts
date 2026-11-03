import 'server-only';
import type { PrismaClient } from '@/generated/prisma/client';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma, type TxCliente } from '@/shared/db';
import { Dinheiro, ErroDominio, falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { dinheiroDoTexto } from '../domain/cargo';
import type { BeneficioCargoTela } from '../domain/cargo-tela';
import { MSG_CONCORRENCIA, tocarVersaoExercicio } from '../infrastructure/parametro-sistema';

// Benefícios do cargo por exercício (US-050 parte 2; plano do P4, Task 13; RN_CAR_06/07). Sem linha,
// o cargo usa os itens "padrão da posição" da Tabela Mestre, no valor dela. Os valores são do custo
// do cargo: mascarados sem cad.salarios (R24). Toda escrita toca a versão do ano (R10, congelado não muda).

type Deps = { cliente?: PrismaClient };

const contextoDe = (ctx: ContextoRequisicao) => ({
  usuarioId: ctx.usuarioId,
  usuarioRotulo: ctx.usuarioRotulo,
  sessaoUid: ctx.sessaoUid,
  ip: ctx.ip,
  unidadeId: null,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


/** Os benefícios do cargo no exercício (cad.cargos:consultar). Sem cad.salarios, sem os valores. */
export async function listarBeneficiosCargo(
  ctx: ContextoRequisicao,
  cargoId: string,
  anoPedido: number | null,
  deps: Deps = {},
): Promise<{ ano: number | null; itens: readonly BeneficioCargoTela[]; mascarado: boolean }> {
  exigir(ctx, 'cad.cargos', 'consultar');
  const mascarado = !ctx.permissoes.has('cad.salarios:consultar');
  const cliente = deps.cliente ?? prisma;
  // Sem ano pedido, o exercício mais recente com parâmetros.
  const ano = anoPedido ?? (await cliente.parametrosExercicio.findFirst({ orderBy: { ano: 'desc' }, select: { ano: true } }))?.ano ?? null;
  if (!UUID.test(cargoId) || ano === null || !Number.isInteger(ano)) return { ano, itens: [], mascarado };
  const [mestre, doCargo] = await Promise.all([
    cliente.beneficioMestre.findMany({ where: { ano, ativo: true }, orderBy: { codigo: 'asc' } }),
    cliente.beneficioCargo.findMany({ where: { cargoId, ano } }),
  ]);
  const porCodigo = new Map(doCargo.map((b) => [b.codigo, b]));
  return {
    ano,
    mascarado,
    itens: mestre.map((m) => {
      const b = porCodigo.get(m.codigo);
      return {
        codigo: m.codigo,
        nome: m.nome,
        forma: m.forma,
        valorMestre: mascarado ? null : (m.valor?.toFixed(2) ?? null),
        percentualMestre: mascarado ? null : (m.percentual?.toFixed(4) ?? null),
        ativo: b ? b.ativo : m.padraoPosicao,
        valorManual: mascarado ? null : (b?.valorManual?.toFixed(2) ?? null),
        origem: b?.origem ?? 'MESTRE',
      };
    }),
  };
}

export type EntradaBeneficioCargo = { codigo: string; ativo: boolean; valorManual: string | null };

/**
 * Grava os benefícios do cargo no exercício (cad.cargos:alterar e cad.salarios). Valor manual →
 * MANUAL (RN_CAR_07); sem valor, MESTRE. O percentual do salário não tem valor manual. Versão do cargo
 * contra escrita concorrente; versão do ano (R10), que recusa o ano congelado.
 */
export async function alterarBeneficiosCargo(
  ctx: ContextoRequisicao,
  cargoId: string,
  ano: number,
  versaoCargo: number,
  itens: readonly EntradaBeneficioCargo[],
  deps: Deps = {},
): Promise<Resultado<{ versao: number }>> {
  exigir(ctx, 'cad.cargos', 'alterar');
  exigir(ctx, 'cad.salarios', 'consultar');
  if (!UUID.test(cargoId) || !Number.isInteger(ano) || !Number.isInteger(versaoCargo)) return falha([{ campo: '_', mensagem: 'Cargo, exercício ou versão inválidos. Recarregue a tela.' }]);
  const cliente = deps.cliente ?? prisma;
  try {
    return await cliente.$transaction(async (tx: TxCliente) => {
      const mestre = new Map((await tx.beneficioMestre.findMany({ where: { ano } })).map((m) => [m.codigo, m]));
      const erros: ErroCampo[] = [];
      const validos: { codigo: string; ativo: boolean; valorManual: Dinheiro | null }[] = [];
      const vistos = new Set<string>();
      itens.forEach((it, i) => {
        const m = mestre.get(it.codigo);
        // Só os itens ativos da Tabela Mestre, os mesmos que a tela mostra.
        if (!m || !m.ativo || vistos.has(it.codigo)) return erros.push({ campo: `itens.${i}.codigo`, mensagem: 'Benefício desconhecido, inativo neste exercício ou repetido.' });
        vistos.add(it.codigo);
        const v = dinheiroDoTexto(it.valorManual);
        if (v === 'invalido') return erros.push({ campo: `itens.${i}.valorManual`, mensagem: `${m.nome}: informe o valor com até 2 casas decimais.` });
        if (v !== null && m.forma === 'PERCENTUAL_SALARIO') return erros.push({ campo: `itens.${i}.valorManual`, mensagem: 'O benefício percentual não tem valor manual.' });
        validos.push({ codigo: it.codigo, ativo: it.ativo, valorManual: v });
      });
      if (erros.length > 0) return falha(erros);

      const cargo = await tx.cargo.findUnique({ where: { id: cargoId }, select: { codigo: true } });
      const r = await tx.cargo.updateMany({ where: { id: cargoId, versao: versaoCargo }, data: { versao: { increment: 1 } } });
      // throw (não return): o rollback desfaz o que já subiu, inclusive a versão do ano (R10/I6).
      if (!cargo || r.count === 0) throw new ErroDominio('cad.concorrencia', MSG_CONCORRENCIA);
      await tocarVersaoExercicio(tx, ano);
      const antes = await tx.beneficioCargo.findMany({ where: { cargoId, ano }, orderBy: { codigo: 'asc' } });
      for (const v of validos) {
        const dados = { ativo: v.ativo, valorManual: v.valorManual?.paraString() ?? null, origem: v.valorManual ? ('MANUAL' as const) : ('MESTRE' as const) };
        await tx.beneficioCargo.upsert({
          where: { cargoId_ano_codigo: { cargoId, ano, codigo: v.codigo } },
          create: { cargoId, ano, codigo: v.codigo, ...dados },
          update: { ...dados, atualizadoEm: new Date() },
        });
      }
      await auditar(tx, {
        contexto: contextoDe(ctx),
        funcionalidade: 'cad.cargos',
        tipo: 'ALTERACAO',
        registroId: cargo.codigo,
        descricao: `Benefícios de ${ano} do cargo ${cargo.codigo} alterados`,
        antes: antes.map((b) => ({ codigo: b.codigo, ativo: b.ativo, valorManual: b.valorManual?.toFixed(2) ?? null, origem: b.origem })),
        depois: validos.map((v) => ({ codigo: v.codigo, ativo: v.ativo, valorManual: v.valorManual, origem: v.valorManual ? 'MANUAL' : 'MESTRE' })),
      });
      return ok({ versao: versaoCargo + 1 });
    });
  } catch (e) {
    if (e instanceof ErroDominio && ['cad.exercicio_congelado', 'cad.premissas_inexistentes', 'cad.concorrencia'].includes(e.codigo)) return falha([{ campo: '_', mensagem: e.message }]);
    throw e;
  }
}
