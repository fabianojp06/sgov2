import type { PrismaClient } from '@/generated/prisma/client';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma, type TxCliente } from '@/shared/db';
import { falha, ok, type Resultado } from '@/shared/kernel';
import { validarNomeExibicao } from '../domain/instituicao';
import { MSG_CONCORRENCIA, obterParametroSistema } from '../infrastructure/parametro-sistema';

// Nome de exibição da instituição (#434; spec §6.7): instituicao.nome_exibicao, no parametro_sistema.
// A concorrência é pelo valor anterior (a tabela não tem versão): se mudou desde a abertura da tela,
// a gravação é recusada.

type Deps = { cliente?: PrismaClient };
const CHAVE = 'instituicao.nome_exibicao';

const contextoDe = (ctx: ContextoRequisicao) => ({
  usuarioId: ctx.usuarioId,
  usuarioRotulo: ctx.usuarioRotulo,
  sessaoUid: ctx.sessaoUid,
  ip: ctx.ip,
  unidadeId: null,
});

export type TelaInstituicao = { nome: string };

export async function obterTelaInstituicao(ctx: ContextoRequisicao, deps: Deps = {}): Promise<TelaInstituicao> {
  exigir(ctx, 'cad.instituicao', 'consultar');
  return { nome: await obterParametroSistema(deps.cliente ?? prisma, CHAVE) };
}

/** Altera o nome (cad.instituicao:alterar). `anterior` é o valor que a tela mostrava. */
export async function alterarNomeExibicao(
  ctx: ContextoRequisicao,
  dados: { nome: string; anterior: string },
  deps: Deps = {},
): Promise<Resultado<{ nome: string }>> {
  exigir(ctx, 'cad.instituicao', 'alterar');
  const v = validarNomeExibicao(dados.nome);
  if (!v.ok) return v;
  const cliente = deps.cliente ?? prisma;
  return cliente.$transaction(async (tx: TxCliente) => {
    // FOR UPDATE: duas gravações juntas não passam as duas pela conferência do valor anterior.
    const linhas = await tx.$queryRaw<{ valor: string }[]>`SELECT "valor" FROM "parametro_sistema" WHERE "chave" = ${CHAVE} FOR UPDATE`;
    // A seed do cad cria a chave vazia em todo ambiente; o sgo_app só altera o valor, nunca insere.
    if (!linhas[0]) return falha([{ campo: '_', mensagem: 'O parâmetro do nome de exibição não está instalado. Avise o suporte.' }]);
    const atual = linhas[0].valor;
    if (atual !== dados.anterior.trim()) return falha([{ campo: '_', mensagem: MSG_CONCORRENCIA }]);
    if (atual === v.valor) return ok({ nome: v.valor });
    await tx.parametroSistema.update({ where: { chave: CHAVE }, data: { valor: v.valor } });
    await auditar(tx, {
      contexto: contextoDe(ctx),
      funcionalidade: 'cad.instituicao',
      tipo: 'ALTERACAO',
      registroId: CHAVE,
      descricao: 'Nome de exibição da instituição alterado',
      antes: { nome: atual },
      depois: { nome: v.valor },
    });
    return ok({ nome: v.valor });
  });
}
