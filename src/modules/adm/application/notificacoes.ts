import { z } from 'zod';
import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { compararClassificacao, listarArvoreContas, type NoConta } from '@/modules/cad/servidor';
import { auditar, type ContextoAuditoria } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma, travarRecurso, type TxCliente } from '@/shared/db';
import { ErroDominio, falha, ok, Percentual, type Resultado } from '@/shared/kernel';
import { MENSAGENS_NOTIFICACAO, ROTULO_TODAS, validarNotificacao, type NotificacaoValidada } from '../domain/notificacao';

// Casos de uso das notificações de desempenho (US-041; EP085 UC02.20, grupo "Desempenho"; plano do
// P10, D-P10-6 a D-P10-9). Exclusivo do Administrador (D-P10-7). Incluir e excluir persistem na hora
// (D-P10-9), com o Histórico na mesma transação; excluir só inativa (soft delete, como nas alçadas).
// As contas vêm do C1 do cad (listarArvoreContas) e ficam guardadas pela classificação, sem FK.
export type DepsNotificacoes = {
  cliente: PrismaClient;
  agora: () => Date;
  /** Árvore do plano de contas com as inativas (C1); injetável nos testes. */
  contas: (tx: TxCliente) => Promise<readonly NoConta[]>;
};

const FUNCIONALIDADE = 'adm.notificacoes';

const resolver = (deps: Partial<DepsNotificacoes>): DepsNotificacoes => ({
  cliente: deps.cliente ?? prisma,
  agora: deps.agora ?? (() => new Date()),
  contas: deps.contas ?? ((tx) => listarArvoreContas(tx, { incluirInativos: true })),
});

// A notificação não é por TP: o Histórico sai sem unidade.
const contextoAuditoria = (ctx: ContextoRequisicao): ContextoAuditoria => ({
  usuarioId: ctx.usuarioId,
  usuarioRotulo: ctx.usuarioRotulo,
  sessaoUid: ctx.sessaoUid,
  ip: ctx.ip,
  unidadeId: null,
});

export type LinhaNotificacao = {
  id: string;
  /** Classificação; null é "Todas". */
  conta: string | null;
  contaRotulo: string;
  /** Conta que não existe mais ou não é sintética ativa no C1: a linha fica, com o aviso (o envio a ignora). */
  contaAviso: string | null;
  /** Em pt-BR, com o símbolo ("80,50%"). */
  limite: string;
  frequenciaDias: number;
  usuario: { id: string; nome: string; ativo: boolean };
  versao: number;
};

export type OpcoesNotificacao = {
  contas: { classificacao: string; rotulo: string; nivel: number }[];
  usuarios: { id: string; nome: string }[];
};

const idValido = (id: string) => z.uuid().safeParse(id).success;
const inexistente = () => new ErroDominio('adm.notificacao_inexistente', MENSAGENS_NOTIFICACAO.INEXISTENTE);
const alterado = () => falha([{ campo: '_', mensagem: MENSAGENS_NOTIFICACAO.ALTERADO }]);
const duplicada = () => falha([{ campo: 'conta', mensagem: MENSAGENS_NOTIFICACAO.DUPLICADA }]);
const ehDuplicada = (erro: unknown) => erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002';
const rotuloConta = (c: { classificacao: string; descricao: string }) => `${c.classificacao} – ${c.descricao}`;

type Retrato = { conta: string | null; limite: string; frequenciaDias: number; usuarioId: string };
const retrato = (n: { contaClassificacao: string | null; limitePercentual: Prisma.Decimal; frequenciaDias: number; usuarioId: string }): Retrato => ({
  conta: n.contaClassificacao,
  limite: n.limitePercentual.toString(),
  frequenciaDias: n.frequenciaDias,
  usuarioId: n.usuarioId,
});

function planificar(nos: readonly NoConta[]): NoConta[] {
  return nos.flatMap((n) => [n, ...planificar(n.filhos)]);
}

// Sintéticas ativas (ativa já implica os ancestrais ativos no C1), na ordem da árvore.
const sinteticasAtivas = (arvore: readonly NoConta[]) => planificar(arvore).filter((c) => c.tipo === 'SINTETICA' && c.ativa);

export async function incluirNotificacao(ctx: ContextoRequisicao, entrada: unknown, deps: Partial<DepsNotificacoes> = {}): Promise<Resultado<{ id: string }>> {
  exigir(ctx, FUNCIONALIDADE, 'incluir');
  const d = resolver(deps);
  const v = validarNotificacao(entrada);
  if (!v.ok) return v;
  try {
    return await d.cliente.$transaction((tx) => gravar(tx, v.valor));
  } catch (erro) {
    // Corrida que escapou da trava (ex.: outra via de gravação): o índice parcial decide, mesma mensagem.
    if (ehDuplicada(erro)) return duplicada();
    throw erro;
  }

  async function gravar(tx: TxCliente, n: NotificacaoValidada): Promise<Resultado<{ id: string }>> {
    if (n.conta !== null && !sinteticasAtivas(await d.contas(tx)).some((c) => c.classificacao === n.conta)) {
      return falha([{ campo: 'conta', mensagem: MENSAGENS_NOTIFICACAO.CONTA_INVALIDA }]);
    }
    const ativo = await tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM usuario WHERE id = ${n.usuarioId}::uuid AND ativo FOR SHARE`;
    if (ativo.length === 0) return falha([{ campo: 'usuarioId', mensagem: MENSAGENS_NOTIFICACAO.USUARIO_INATIVO }]);
    // Dois administradores incluindo o mesmo par: a trava serializa e o segundo vê o primeiro (A3).
    // "Todas" e uma conta específica são pares diferentes e podem coexistir para o mesmo usuário
    // (B9 da revisão do plano): o envio futuro deduplica por usuário.
    await travarRecurso(tx, `adm.notificacao:${n.usuarioId}:${n.conta ?? '*'}`);
    const existente = await tx.notificacaoDesempenho.count({ where: { usuarioId: n.usuarioId, contaClassificacao: n.conta, ativa: true } });
    if (existente > 0) return duplicada();
    const criada = await tx.notificacaoDesempenho.create({
      data: { contaClassificacao: n.conta, limitePercentual: n.limite, frequenciaDias: n.frequenciaDias, usuarioId: n.usuarioId, criadaEm: d.agora() },
    });
    await auditar(tx, { contexto: contextoAuditoria(ctx), funcionalidade: FUNCIONALIDADE, tipo: 'INSERCAO', registroId: criada.id, depois: retrato(criada) });
    return ok({ id: criada.id });
  }
}

// Excluir (A4, UC0.04): soft delete, com a versão lida pela tela (US-011).
export async function excluirNotificacao(ctx: ContextoRequisicao, id: string, versao: number, deps: Partial<DepsNotificacoes> = {}): Promise<Resultado<void>> {
  exigir(ctx, FUNCIONALIDADE, 'excluir');
  const { cliente, agora } = resolver(deps);
  if (!idValido(id)) throw inexistente();
  return cliente.$transaction(async (tx) => {
    const atual = await tx.notificacaoDesempenho.findUnique({ where: { id } });
    if (!atual) throw inexistente();
    if (atual.versao !== versao) return alterado();
    if (!atual.ativa) return falha([{ campo: '_', mensagem: MENSAGENS_NOTIFICACAO.INATIVA }]);
    const { count } = await tx.notificacaoDesempenho.updateMany({ where: { id, versao, ativa: true }, data: { ativa: false, inativadaEm: agora(), versao: { increment: 1 } } });
    if (count !== 1) return alterado();
    await auditar(tx, { contexto: contextoAuditoria(ctx), funcionalidade: FUNCIONALIDADE, tipo: 'EXCLUSAO', registroId: id, antes: retrato(atual) });
    return ok(undefined);
  });
}

// A grade mostra só as ativas (RN0085): "Todas" primeiro, depois a conta pela classificação e o
// destinatário pelo nome.
export async function listarNotificacoes(ctx: ContextoRequisicao, deps: Partial<DepsNotificacoes> = {}): Promise<LinhaNotificacao[]> {
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const d = resolver(deps);
  const [linhas, arvore] = await Promise.all([
    d.cliente.notificacaoDesempenho.findMany({ where: { ativa: true }, include: { usuario: { select: { id: true, nome: true, ativo: true } } } }),
    d.contas(d.cliente),
  ]);
  const todas = new Map(planificar(arvore).map((c) => [c.classificacao, c]));
  return linhas
    .map((l): LinhaNotificacao => {
      const c = l.contaClassificacao === null ? null : todas.get(l.contaClassificacao);
      const valida = l.contaClassificacao === null || (c !== undefined && c !== null && c.ativa && c.tipo === 'SINTETICA');
      return {
        id: l.id,
        conta: l.contaClassificacao,
        contaRotulo: l.contaClassificacao === null ? ROTULO_TODAS : c ? rotuloConta(c) : l.contaClassificacao,
        contaAviso: valida ? null : MENSAGENS_NOTIFICACAO.CONTA_INEXISTENTE,
        limite: Percentual.dePontos(l.limitePercentual.toString()).formatar(),
        frequenciaDias: l.frequenciaDias,
        usuario: l.usuario,
        versao: l.versao,
      };
    })
    .sort(
      (a, b) =>
        (a.conta === null ? -1 : 0) - (b.conta === null ? -1 : 0) ||
        (a.conta !== null && b.conta !== null ? compararClassificacao(a.conta, b.conta) : 0) ||
        a.usuario.nome.localeCompare(b.usuario.nome, 'pt-BR'),
    );
}

// Opções do formulário: as sintéticas ativas do C1 (a tela acrescenta "Todas", RN0051) e só os
// usuários ativos (RN0086), por nome.
export async function listarOpcoesNotificacao(ctx: ContextoRequisicao, deps: Partial<DepsNotificacoes> = {}): Promise<OpcoesNotificacao> {
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const d = resolver(deps);
  const [arvore, usuarios] = await Promise.all([
    d.contas(d.cliente),
    d.cliente.usuario.findMany({ where: { ativo: true }, select: { id: true, nome: true }, orderBy: { nome: 'asc' } }),
  ]);
  return { contas: sinteticasAtivas(arvore).map((c) => ({ classificacao: c.classificacao, rotulo: rotuloConta(c), nivel: c.nivel })), usuarios };
}
