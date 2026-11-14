import type { PrismaClient } from '@/generated/prisma/client';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma, type TxCliente } from '@/shared/db';
import { falha, ok, type Resultado } from '@/shared/kernel';
import { ehPapel, gravarClassificacoes, lerClassificacoes, PAPEIS, PAPEIS_CONTA_RELATORIO, type PapelContaRelatorio } from '../domain/contas-relatorio';
import { MSG_CONCORRENCIA, obterParametroSistema } from '../infrastructure/parametro-sistema';

// Contas dos relatórios (US-097; decisão do PO no #119). Consulta com cad.plano_contas:consultar; a marcação é
// parametrização local da tela do plano de contas, com cad.plano_contas:executar (C27, como a US-045). A
// concorrência é pelo valor anterior (o parametro_sistema não tem versão), como no nome da instituição (#434).

type Deps = { cliente?: PrismaClient };
const contextoDe = (ctx: ContextoRequisicao) => ({
  usuarioId: ctx.usuarioId,
  usuarioRotulo: ctx.usuarioRotulo,
  sessaoUid: ctx.sessaoUid,
  ip: ctx.ip,
  unidadeId: null,
});

export const MSG_SO_SINTETICA = 'Marque só contas sintéticas ativas. Recarregue a tela.';
export const MSG_PAPEL = 'Relatório inválido. Recarregue a tela.';

export type SinteticaTela = Readonly<{ classificacao: string; descricao: string }>;
export type PapelTela = Readonly<{
  papel: PapelContaRelatorio;
  rotulo: string;
  ajuda: string;
  /** As classificações marcadas (inclusive a que uma recarga inativou, para a GFIN ver e desmarcar). */
  marcadas: readonly string[];
  /** O valor gravado, que volta na alteração (concorrência). */
  valor: string;
}>;
export type TelaContasRelatorio = Readonly<{ papeis: readonly PapelTela[]; sinteticas: readonly SinteticaTela[] }>;

/** Os papéis com as sintéticas marcadas e as sintéticas ativas que podem ser marcadas, em ordem de classificação. */
export async function obterTelaContasRelatorio(ctx: ContextoRequisicao, deps: Deps = {}): Promise<TelaContasRelatorio> {
  exigir(ctx, 'cad.plano_contas', 'consultar');
  const cliente = deps.cliente ?? prisma;
  const sinteticas = await cliente.contaContabil.findMany({
    where: { tipo: 'SINTETICA', ativa: true },
    orderBy: { classificacao: 'asc' },
    select: { classificacao: true, descricao: true },
  });
  const papeis: PapelTela[] = [];
  for (const papel of PAPEIS) {
    const { chave, rotulo, ajuda } = PAPEIS_CONTA_RELATORIO[papel];
    const valor = await obterParametroSistema(cliente, chave);
    papeis.push({ papel, rotulo, ajuda, marcadas: lerClassificacoes(valor), valor });
  }
  return { papeis, sinteticas };
}

/** Grava as sintéticas de um papel (cad.plano_contas:executar). `anterior` é o valor que a tela mostrava. */
export async function alterarContasRelatorio(
  ctx: ContextoRequisicao,
  dados: { papel: string; classificacoes: readonly string[]; anterior: string },
  deps: Deps = {},
): Promise<Resultado<{ valor: string }>> {
  exigir(ctx, 'cad.plano_contas', 'executar');
  if (!ehPapel(dados.papel)) return falha([{ campo: '_', mensagem: MSG_PAPEL }]);
  const { chave, rotulo } = PAPEIS_CONTA_RELATORIO[dados.papel];
  const novo = gravarClassificacoes(dados.classificacoes);
  const cliente = deps.cliente ?? prisma;
  return cliente.$transaction(async (tx: TxCliente) => {
    // FOR UPDATE: duas gravações juntas não passam as duas pela conferência do valor anterior.
    const linhas = await tx.$queryRaw<{ valor: string }[]>`SELECT "valor" FROM "parametro_sistema" WHERE "chave" = ${chave} FOR UPDATE`;
    // A seed do cad cria a chave vazia em todo ambiente; o sgo_app só altera o valor, nunca insere.
    if (!linhas[0]) return falha([{ campo: '_', mensagem: 'O parâmetro das contas dos relatórios não está instalado. Avise o suporte.' }]);
    const atual = linhas[0].valor;
    if (atual !== dados.anterior) return falha([{ campo: '_', mensagem: MSG_CONCORRENCIA }]);
    if (atual === novo) return ok({ valor: novo });
    // Só as que entram agora precisam ser sintéticas ativas; a que já estava marcada e foi inativada pode ficar.
    const jaMarcadas = new Set(lerClassificacoes(atual));
    const entrando = lerClassificacoes(novo).filter((c) => !jaMarcadas.has(c));
    if (entrando.length > 0) {
      const validas = await tx.contaContabil.count({ where: { classificacao: { in: entrando }, tipo: 'SINTETICA', ativa: true } });
      if (validas !== entrando.length) return falha([{ campo: 'classificacoes', mensagem: MSG_SO_SINTETICA }]);
    }
    await tx.parametroSistema.update({ where: { chave }, data: { valor: novo } });
    await auditar(tx, {
      contexto: contextoDe(ctx),
      funcionalidade: 'cad.plano_contas',
      tipo: 'ALTERACAO',
      registroId: chave,
      descricao: `Contas sintéticas de ${rotulo} dos relatórios alteradas`,
      antes: { contas: lerClassificacoes(atual) },
      depois: { contas: lerClassificacoes(novo) },
    });
    return ok({ valor: novo });
  });
}
