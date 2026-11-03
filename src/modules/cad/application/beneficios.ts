import type { PrismaClient } from '@/generated/prisma/client';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma, type TxCliente } from '@/shared/db';
import { ErroDominio, falha, ok, type Resultado } from '@/shared/kernel';
import { validarBeneficio, type BeneficioMestre, type EntradaBeneficio } from '../domain/beneficios';
import { lerBeneficiosMestre } from '../infrastructure/beneficios-mestre';
import { carregarIndiceEstrutura } from '../infrastructure/estrutura-financeira';
import { MSG_CONCORRENCIA, tocarVersaoExercicio } from '../infrastructure/parametro-sistema';

// Casos de uso da Tabela Mestre (US-050; plano do P4, Task 10). Permissão primeiro, auditoria no
// mesmo tx com Dinheiro/Percentual, versão única do ano (R10) e recusa de origem blindada (M4).
const FUNCIONALIDADE = 'cad.beneficios';
// `ano` e `versao` vêm como parâmetros do caso de uso, nunca dentro dos dados.
const CAMPOS_ORIGEM_BLINDADA = ['provisorio', 'versao', 'ano', 'atualizadoEm'] as const;
type Deps = { cliente?: PrismaClient };

const contextoDe = (ctx: ContextoRequisicao) => ({
  usuarioId: ctx.usuarioId,
  usuarioRotulo: ctx.usuarioRotulo,
  sessaoUid: ctx.sessaoUid,
  ip: ctx.ip,
  unidadeId: ctx.unidadeId ?? null,
});

async function recusarOrigemBlindada(cliente: PrismaClient, ctx: ContextoRequisicao, registro: string, campos: string[]): Promise<never> {
  await cliente.$transaction((tx) =>
    auditar(tx, {
      contexto: contextoDe(ctx),
      funcionalidade: FUNCIONALIDADE,
      tipo: 'SISTEMA',
      registroId: registro,
      descricao: 'cad.violacao_governanca: campo de origem blindada no pedido',
      depois: { campos },
    }),
  );
  throw new ErroDominio('cad.violacao_governanca', 'O pedido tem campos que não podem ser alterados pela tela.', { campos });
}

const blindados = (bruto: unknown) =>
  bruto !== null && typeof bruto === 'object' ? CAMPOS_ORIGEM_BLINDADA.filter((c) => Object.hasOwn(bruto, c)) : [];

const anoValido = (ano: number) => Number.isInteger(ano) && ano >= 2000 && ano <= 2099;

function comoResultado(e: unknown): Resultado<void> {
  if (e instanceof ErroDominio && ['cad.concorrencia', 'cad.exercicio_congelado', 'cad.premissas_inexistentes'].includes(e.codigo)) {
    return falha([{ campo: '_', mensagem: e.message }]);
  }
  throw e;
}

// Item com valor (ou percentual) informado deixa de ser provisório.
const provisorio = (b: { valor: unknown; percentual: unknown }) => b.valor === null && b.percentual === null;

const dadosGravaveis = (v: Omit<BeneficioMestre, 'versao' | 'provisorio'>) => ({
  nome: v.nome,
  valor: v.valor?.paraString() ?? null,
  percentual: v.percentual?.paraString() ?? null,
  conta: v.conta,
  padraoPosicao: v.padraoPosicao,
  ativo: v.ativo,
  provisorio: provisorio(v),
});

export async function listarBeneficiosMestre(ctx: ContextoRequisicao, ano: number, deps: Deps = {}): Promise<readonly BeneficioMestre[]> {
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  if (!anoValido(ano)) return [];
  return lerBeneficiosMestre(deps.cliente ?? prisma, ano);
}

/** Exercícios com parâmetros, do mais recente ao mais antigo: os que têm Tabela Mestre (seletor de ano). */
export async function listarAnosBeneficios(ctx: ContextoRequisicao, deps: Deps = {}): Promise<readonly number[]> {
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  return (await (deps.cliente ?? prisma).parametrosExercicio.findMany({ select: { ano: true }, orderBy: { ano: 'desc' } })).map((p) => p.ano);
}

export async function incluirBeneficioMestre(ctx: ContextoRequisicao, ano: number, dados: EntradaBeneficio, deps: Deps = {}): Promise<Resultado<void>> {
  exigir(ctx, FUNCIONALIDADE, 'incluir');
  const cliente = deps.cliente ?? prisma;
  if (!anoValido(ano)) return falha([{ campo: '_', mensagem: 'Exercício inválido. Recarregue a tela.' }]);
  const b = blindados(dados);
  if (b.length > 0) return recusarOrigemBlindada(cliente, ctx, `${ano}/${String(dados.codigo)}`, b);
  try {
    return await cliente.$transaction(async (tx: TxCliente) => {
      const indice = await carregarIndiceEstrutura(tx);
      const v = validarBeneficio(dados, (c) => indice.contaAnaliticaAtiva(c));
      if (!v.ok) return v;
      // A versão do ano primeiro: trava o ano e serializa duas inclusões do mesmo código.
      await tocarVersaoExercicio(tx, ano);
      if (await tx.beneficioMestre.findUnique({ where: { ano_codigo: { ano, codigo: v.valor.codigo } }, select: { codigo: true } })) {
        return falha([{ campo: 'codigo', mensagem: 'Já existe um benefício com esse código neste exercício.' }]);
      }
      await tx.beneficioMestre.create({ data: { ano, codigo: v.valor.codigo, forma: v.valor.forma, ...dadosGravaveis(v.valor) } });
      await auditar(tx, {
        contexto: contextoDe(ctx),
        funcionalidade: FUNCIONALIDADE,
        tipo: 'INSERCAO',
        registroId: `${ano}/${v.valor.codigo}`,
        descricao: `Benefício ${v.valor.codigo} incluído na Tabela Mestre de ${ano}`,
        depois: v.valor,
      });
      return ok(undefined);
    });
  } catch (e) {
    return comoResultado(e);
  }
}

/** Altera um item (a forma e o código não mudam). Versão do item contra escrita concorrente. */
export async function alterarBeneficioMestre(
  ctx: ContextoRequisicao,
  ano: number,
  codigo: string,
  versao: number,
  dados: EntradaBeneficio,
  deps: Deps = {},
): Promise<Resultado<void>> {
  exigir(ctx, FUNCIONALIDADE, 'alterar');
  const cliente = deps.cliente ?? prisma;
  if (!anoValido(ano) || !Number.isInteger(versao) || versao < 1) return falha([{ campo: '_', mensagem: 'Exercício ou versão inválidos. Recarregue a tela.' }]);
  const b = blindados(dados);
  if (b.length > 0) return recusarOrigemBlindada(cliente, ctx, `${ano}/${codigo}`, b);
  try {
    return await cliente.$transaction(async (tx: TxCliente) => {
      const atual = (await lerBeneficiosMestre(tx, ano)).find((x) => x.codigo === codigo);
      if (!atual) return falha([{ campo: '_', mensagem: 'Benefício não encontrado neste exercício.' }]);
      if (dados.codigo !== codigo || dados.forma !== atual.forma) {
        return falha([{ campo: 'forma', mensagem: 'O código e a forma de um benefício não mudam; inative e inclua outro.' }]);
      }
      const indice = await carregarIndiceEstrutura(tx);
      const v = validarBeneficio(dados, (c) => indice.contaAnaliticaAtiva(c));
      if (!v.ok) return v;
      await tocarVersaoExercicio(tx, ano);
      const n = await tx.beneficioMestre.updateMany({
        where: { ano, codigo, versao },
        data: { ...dadosGravaveis(v.valor), versao: { increment: 1 }, atualizadoEm: new Date() },
      });
      if (n.count === 0) throw new ErroDominio('cad.concorrencia', MSG_CONCORRENCIA);
      const { versao: _v, ...antes } = atual;
      void _v;
      await auditar(tx, {
        contexto: contextoDe(ctx),
        funcionalidade: FUNCIONALIDADE,
        tipo: 'ALTERACAO',
        registroId: `${ano}/${codigo}`,
        descricao: `Benefício ${codigo} alterado na Tabela Mestre de ${ano}`,
        antes,
        depois: { ...v.valor, provisorio: provisorio(v.valor) },
      });
      return ok(undefined);
    });
  } catch (e) {
    return comoResultado(e);
  }
}
