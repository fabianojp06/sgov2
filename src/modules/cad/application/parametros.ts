import type { PrismaClient } from '@/generated/prisma/client';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma, type TxCliente } from '@/shared/db';
import { Dinheiro, ErroDominio, falha, ok, type Resultado } from '@/shared/kernel';
import { COMPONENTES_COM_CONTA, validarParametros, validarSalarioMinimo, type EntradaParametros, type ParametrosExercicio } from '../domain/parametros';
import { carregarIndiceEstrutura } from '../infrastructure/estrutura-financeira';
import { lerParametrosExercicio, tocarVersaoExercicio } from '../infrastructure/parametro-sistema';

// Casos de uso dos parâmetros por exercício (US-053; plano do P4, Task 9a). Cada um confere a
// permissão primeiro e audita no mesmo tx, com antes e depois em Dinheiro/Percentual.

// Campos de ORIGEM BLINDADA (spec §5, M4): nunca vêm da tela. Conferidos no payload bruto, antes
// do parse, porque um schema que descarta chave desconhecida esconderia a violação (M-n4).
const CAMPOS_ORIGEM_BLINDADA = ['provisorio', 'congeladoEm', 'congelado', 'versao', 'ano', 'atualizadoEm'] as const;

type Deps = { cliente?: PrismaClient };

const contextoDe = (ctx: ContextoRequisicao) => ({
  usuarioId: ctx.usuarioId,
  usuarioRotulo: ctx.usuarioRotulo,
  sessaoUid: ctx.sessaoUid,
  ip: ctx.ip,
  unidadeId: null,
});

// A violação é auditada numa transação própria: a operação em si não acontece.
async function recusarOrigemBlindada(cliente: PrismaClient, ctx: ContextoRequisicao, funcionalidade: string, ano: number | null, campos: string[]): Promise<never> {
  await cliente.$transaction((tx) =>
    auditar(tx, {
      contexto: contextoDe(ctx),
      funcionalidade,
      tipo: 'SISTEMA',
      registroId: ano === null ? 'ano_invalido' : String(ano),
      descricao: 'cad.violacao_governanca: campo de origem blindada no pedido',
      depois: { campos },
    }),
  );
  throw new ErroDominio('cad.violacao_governanca', 'O pedido tem campos que não podem ser alterados pela tela.', { campos });
}

// Também nos itens de encargo e nas contas, onde `provisorio` e `nome` não vêm da tela.
function camposBlindados(bruto: unknown): string[] {
  if (bruto === null || typeof bruto !== 'object') return [];
  const achados: string[] = CAMPOS_ORIGEM_BLINDADA.filter((c) => Object.hasOwn(bruto, c));
  const b = bruto as { encargos?: unknown; contas?: unknown };
  if (Array.isArray(b.encargos)) {
    b.encargos.forEach((e: unknown, i) => {
      if (e && typeof e === 'object') for (const c of ['provisorio', 'nome']) if (Object.hasOwn(e, c)) achados.push(`encargos.${i}.${c}`);
    });
  }
  if (b.contas && typeof b.contas === 'object' && Object.hasOwn(b.contas, 'provisorio')) achados.push('contas.provisorio');
  return achados;
}

/**
 * M-n4 na casca da Server Action: confere o pedido bruto (ano e versão à parte, que vêm da tela)
 * antes de qualquer parse, para que um campo blindado nunca escape da auditoria só porque veio junto
 * com outro erro de schema. Com campo blindado, audita e lança cad.violacao_governanca.
 */
export async function conferirOrigemBlindada(ctx: ContextoRequisicao, funcionalidade: 'cad.parametros' | 'cad.salario_minimo', bruto: unknown, deps: Deps = {}): Promise<void> {
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return;
  const { ano, versao: _v, ...resto } = bruto as Record<string, unknown>;
  void _v;
  const blindados = camposBlindados(resto);
  if (blindados.length > 0) {
    const anoRegistro = typeof ano === 'number' && Number.isInteger(ano) && ano >= 2000 && ano <= 2099 ? ano : null;
    await recusarOrigemBlindada(deps.cliente ?? prisma, ctx, funcionalidade, anoRegistro, blindados);
  }
}

// ano e versao vêm da tela: inteiros, ou erro de formulário (nunca 500 nem concorrência desligada).
function anoEVersaoValidos(ano: number, versao: number): boolean {
  return Number.isInteger(ano) && ano >= 2000 && ano <= 2099 && Number.isInteger(versao) && versao >= 1;
}
const ERRO_ANO_VERSAO = falha([{ campo: '_', mensagem: 'Exercício ou versão inválidos. Recarregue a tela.' }]);

// Erros de domínio esperados viram erro de formulário; o resto sobe.
function comoResultado(e: unknown): Resultado<never> {
  if (e instanceof ErroDominio && ['cad.concorrencia', 'cad.exercicio_congelado', 'cad.premissas_inexistentes'].includes(e.codigo)) {
    return falha([{ campo: '_', mensagem: e.message }]);
  }
  throw e;
}

export async function obterParametrosExercicio(ctx: ContextoRequisicao, ano: number, deps: Deps = {}): Promise<ParametrosExercicio | null> {
  exigir(ctx, 'cad.parametros', 'consultar');
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2099) return null;
  return lerParametrosExercicio(deps.cliente ?? prisma, ano);
}

/** Altera premissas, semáforo, encargos e contas do ano (cad.parametros:alterar). Devolve a versão nova do ano. */
export async function alterarParametrosExercicio(
  ctx: ContextoRequisicao,
  ano: number,
  versao: number,
  dados: EntradaParametros,
  deps: Deps = {},
): Promise<Resultado<{ versao: number }>> {
  exigir(ctx, 'cad.parametros', 'alterar');
  const cliente = deps.cliente ?? prisma;
  if (!anoEVersaoValidos(ano, versao)) return ERRO_ANO_VERSAO;
  // Defesa em profundidade: a ação já confere no pedido bruto (conferirOrigemBlindada) e o schema
  // .strict() dela não deixa esses campos chegarem aqui; outros chamadores continuam cobertos.
  const blindados = camposBlindados(dados);
  if (blindados.length > 0) return recusarOrigemBlindada(cliente, ctx, 'cad.parametros', ano, blindados);
  try {
    return await cliente.$transaction(async (tx: TxCliente) => {
      const indice = await carregarIndiceEstrutura(tx);
      const v = validarParametros(dados, (c) => indice.contaAnaliticaAtiva(c));
      if (!v.ok) return v;
      const antes = await lerParametrosExercicio(tx, ano);
      const nova = await tocarVersaoExercicio(tx, ano, versao);
      await tx.parametrosExercicio.update({
        where: { ano },
        data: {
          reajuste: v.valor.reajuste.paraString(),
          mesDataBase: v.valor.mesDataBase,
          ipca: v.valor.ipca.paraString(),
          diasUteisMes: v.valor.diasUteisMes,
          semaforoVerdeAte: v.valor.semaforo.verdeAte.paraString(),
          semaforoAmareloAte: v.valor.semaforo.amareloAte.paraString(),
          semaforoLaranjaAte: v.valor.semaforo.laranjaAte.paraString(),
        },
      });
      for (const e of v.valor.encargos) {
        await tx.encargoExercicio.update({
          where: { ano_componente: { ano, componente: e.componente } },
          data: { percentual: e.percentual.paraString(), conta: e.conta },
        });
      }
      for (const componente of COMPONENTES_COM_CONTA) {
        await tx.contaComponenteExercicio.update({ where: { ano_componente: { ano, componente } }, data: { conta: v.valor.contas[componente] } });
      }
      await auditar(tx, {
        contexto: contextoDe(ctx),
        funcionalidade: 'cad.parametros',
        tipo: 'ALTERACAO',
        registroId: String(ano),
        descricao: `Parâmetros de ${ano} alterados`,
        antes,
        depois: await lerParametrosExercicio(tx, ano),
      });
      return ok({ versao: nova });
    });
  } catch (e) {
    return comoResultado(e);
  }
}

/** Salário mínimo nacional do ano (cad.salario_minimo:alterar), base da insalubridade (RN_CAR_11). Devolve a versão nova. */
export async function alterarSalarioMinimo(
  ctx: ContextoRequisicao,
  ano: number,
  versao: number,
  valor: string,
  deps: Deps = {},
): Promise<Resultado<{ versao: number }>> {
  exigir(ctx, 'cad.salario_minimo', 'alterar');
  const cliente = deps.cliente ?? prisma;
  if (!anoEVersaoValidos(ano, versao)) return ERRO_ANO_VERSAO;
  const v = validarSalarioMinimo(valor);
  if (!v.ok) return v;
  try {
    return await cliente.$transaction(async (tx: TxCliente) => {
      const antes = await tx.parametrosExercicio.findUnique({ where: { ano }, select: { salarioMinimo: true } });
      const nova = await tocarVersaoExercicio(tx, ano, versao);
      await tx.parametrosExercicio.update({ where: { ano }, data: { salarioMinimo: v.valor.paraString() } });
      await auditar(tx, {
        contexto: contextoDe(ctx),
        funcionalidade: 'cad.salario_minimo',
        tipo: 'ALTERACAO',
        registroId: String(ano),
        descricao: `Salário mínimo de ${ano} alterado`,
        antes: { salarioMinimo: antes?.salarioMinimo ? Dinheiro.de(antes.salarioMinimo.toString()) : null },
        depois: { salarioMinimo: v.valor },
      });
      return ok({ versao: nova });
    });
  } catch (e) {
    return comoResultado(e);
  }
}
