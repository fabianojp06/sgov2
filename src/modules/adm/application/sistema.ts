import type { PrismaClient } from '@/generated/prisma/client';
import { auditar, type ContextoAuditoria } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma, travarRecurso, type TxCliente } from '@/shared/db';
import { ConflitoConcorrencia, ErroDominio } from '@/shared/kernel';
import { FUNCIONALIDADE_SISTEMA, normalizarMotivo, TRAVA_SISTEMA } from '../domain/sistema';
import { manutencaoEfetiva, obterConfiguracaoAcesso } from './configuracao';

// Ativar e desativar o sistema (US-036, EP085 UC02.01). Sistema inativo e manutenção são o mesmo
// indicador (D-P9-1). Desativar grava, numa transação, o indicador, o instante em que a desativação
// vale (agora + espera), o motivo, o autor e o Histórico (D-P9-2); até o instante, as telas mostram o
// aviso com a contagem, e a primeira requisição depois dele desconecta os outros usuários (aut,
// efetivarDesativacao). As duas mudanças de estado passam pela trava adm:sistema e releem o
// indicador depois dela (D-P9-6): a segunda de duas simultâneas recebe ConflitoConcorrencia.
// O registro alterado é a linha única da configuração de acesso.
const REGISTRO = 'configuracao_acesso:1';

export type DepsSistema = { cliente: PrismaClient; agora: () => Date };

const resolver = (deps: Partial<DepsSistema>): DepsSistema => ({ cliente: deps.cliente ?? prisma, agora: deps.agora ?? (() => new Date()) });

// O estado do sistema não é por TP: o Histórico sai sem unidade.
const contextoAuditoria = (ctx: ContextoRequisicao): ContextoAuditoria => ({
  usuarioId: ctx.usuarioId,
  usuarioRotulo: ctx.usuarioRotulo,
  sessaoUid: ctx.sessaoUid,
  ip: ctx.ip,
  unidadeId: null,
});

export type EstadoSistema = {
  // Falso só quando a desativação já vale (manutenção efetiva).
  ativo: boolean;
  // Instante em que a desativação vale (no futuro durante a contagem); nulo sem desativação ou com a
  // manutenção ligada direto no banco.
  desativacaoEm: Date | null;
  motivo: string | null;
  // Quem desativou (usuarioId): não recebe o aviso nem cai.
  por: string | null;
};

export async function obterEstadoSistema(tx: TxCliente, agora: Date): Promise<EstadoSistema> {
  const c = await obterConfiguracaoAcesso(tx);
  return {
    ativo: !manutencaoEfetiva(c, agora),
    desativacaoEm: c.manutencao ? c.manutencaoAPartir : null,
    motivo: c.manutencaoMotivo,
    por: c.manutencaoPor,
  };
}

// Estado para a tela (US-036): a mesma leitura, com a permissão de consulta.
export async function consultarEstadoSistema(ctx: ContextoRequisicao, deps: Partial<DepsSistema> = {}): Promise<EstadoSistema> {
  exigir(ctx, FUNCIONALIDADE_SISTEMA, 'consultar');
  const { cliente, agora } = resolver(deps);
  return obterEstadoSistema(cliente, agora());
}

// Para a efetivação (aut): sob a trava adm:sistema, se a desativação já vale, devolve o corte (as
// sessões criadas antes dele caem) e quem desativou. Com a manutenção ligada direto no banco (sem
// instante), fixa o instante agora: as sessões abertas depois (Administradores que entram de novo,
// RN0023) não caem numa efetivação seguinte. A transação é de quem chama.
export async function travarDesativacaoEfetiva(tx: TxCliente, agora: Date): Promise<{ corte: Date; por: string | null } | null> {
  await travarRecurso(tx, TRAVA_SISTEMA);
  const c = await obterConfiguracaoAcesso(tx);
  if (!manutencaoEfetiva(c, agora)) return null;
  if (c.manutencaoAPartir) return { corte: c.manutencaoAPartir, por: c.manutencaoPor };
  await tx.configuracaoAcesso.update({ where: { id: 1 }, data: { manutencaoAPartir: agora } });
  return { corte: agora, por: c.manutencaoPor };
}

export async function desativarSistema(ctx: ContextoRequisicao, entrada: { motivo: unknown }, deps: Partial<DepsSistema> = {}): Promise<{ desativacaoEm: Date }> {
  exigir(ctx, FUNCIONALIDADE_SISTEMA, 'alterar');
  const { cliente, agora } = resolver(deps);
  const v = normalizarMotivo(entrada.motivo);
  if (!v.ok) throw new ErroDominio('adm.sistema_motivo', v.mensagem);
  return cliente.$transaction(async (tx) => {
    await travarRecurso(tx, TRAVA_SISTEMA);
    const c = await obterConfiguracaoAcesso(tx);
    // Já desativado ou com a desativação agendada: a tela estava desatualizada.
    if (c.manutencao) throw new ConflitoConcorrencia();
    const desativacaoEm = new Date(agora().getTime() + c.desconexaoEsperaMin * 60 * 1000);
    await tx.configuracaoAcesso.update({
      where: { id: 1 },
      data: { manutencao: true, manutencaoAPartir: desativacaoEm, manutencaoMotivo: v.motivo, manutencaoPorId: ctx.usuarioId },
    });
    // [PROVISÓRIO] texto do Histórico; o tipo "Desativação" do UC02.01 vai no status de depois.
    await auditar(tx, {
      contexto: contextoAuditoria(ctx),
      funcionalidade: FUNCIONALIDADE_SISTEMA,
      tipo: 'ALTERACAO',
      registroId: REGISTRO,
      descricao: `Desativação do sistema. Motivo: ${v.motivo}`,
      antes: { status: 'ATIVO' },
      depois: { status: 'INATIVO', desativacaoEm: desativacaoEm.toISOString(), motivo: v.motivo },
    });
    return { desativacaoEm };
  });
}

// Ativar: com o sistema inativo, libera o acesso; durante a contagem, cancela a desativação.
export async function ativarSistema(ctx: ContextoRequisicao, deps: Partial<DepsSistema> = {}): Promise<void> {
  exigir(ctx, FUNCIONALIDADE_SISTEMA, 'alterar');
  const { cliente, agora } = resolver(deps);
  await cliente.$transaction(async (tx) => {
    await travarRecurso(tx, TRAVA_SISTEMA);
    const c = await obterConfiguracaoAcesso(tx);
    if (!c.manutencao) throw new ConflitoConcorrencia();
    const efetiva = manutencaoEfetiva(c, agora());
    await tx.configuracaoAcesso.update({
      where: { id: 1 },
      data: { manutencao: false, manutencaoAPartir: null, manutencaoMotivo: null, manutencaoPorId: null },
    });
    // [PROVISÓRIOS] textos do Histórico.
    await auditar(tx, {
      contexto: contextoAuditoria(ctx),
      funcionalidade: FUNCIONALIDADE_SISTEMA,
      tipo: 'ALTERACAO',
      registroId: REGISTRO,
      descricao: efetiva ? 'Ativação do sistema' : 'Ativação do sistema (desativação agendada cancelada)',
      antes: { status: efetiva ? 'INATIVO' : 'ATIVO', desativacaoEm: c.manutencaoAPartir?.toISOString() ?? null, motivo: c.manutencaoMotivo },
      depois: { status: 'ATIVO' },
    });
  });
}

export type LinhaAtivacao = { tipo: 'Ativação' | 'Desativação'; motivo: string | null; em: Date; usuario: string };

// Histórico de ativações e desativações da tela (REQ0053), do Histórico de Operações, mais recente
// primeiro e sem paginação. Só as mudanças de estado (ALTERACAO): as negações da guarda ficam fora.
export async function listarAtivacoes(ctx: ContextoRequisicao, deps: Partial<DepsSistema> = {}): Promise<LinhaAtivacao[]> {
  exigir(ctx, FUNCIONALIDADE_SISTEMA, 'consultar');
  const { cliente } = resolver(deps);
  const linhas = await cliente.historicoOperacao.findMany({
    where: { funcionalidade: FUNCIONALIDADE_SISTEMA, tipoOperacao: 'ALTERACAO' },
    orderBy: [{ ocorridoEm: 'desc' }, { id: 'desc' }],
    select: { ocorridoEm: true, usuarioId: true, usuarioRotulo: true, depois: true },
  });
  const ids = [...new Set(linhas.flatMap((l) => (l.usuarioId ? [l.usuarioId] : [])))];
  const nomes = new Map((await cliente.usuario.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } })).map((u) => [u.id, u.nome]));
  return linhas.map((l) => {
    const depois = (l.depois ?? {}) as { status?: unknown; motivo?: unknown };
    const desativacao = depois.status === 'INATIVO';
    return {
      tipo: desativacao ? 'Desativação' : 'Ativação',
      motivo: desativacao && typeof depois.motivo === 'string' ? depois.motivo : null,
      em: l.ocorridoEm,
      usuario: (l.usuarioId && nomes.get(l.usuarioId)) || l.usuarioRotulo,
    };
  });
}
