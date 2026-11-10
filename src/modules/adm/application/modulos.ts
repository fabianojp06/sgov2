import type { PrismaClient } from '@/generated/prisma/client';
import { auditar, type ContextoAuditoria } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma, travarRecurso, type TxCliente } from '@/shared/db';
import { ErroDominio, falha, ok, type Resultado } from '@/shared/kernel';
import { descricaoFuncionalidade, descricaoModulo, MENSAGENS_MODULOS, podeDesativarModulo } from '../domain/modulos';

// Ativar e desativar módulos e funcionalidades (US-035; EP085 UC02.05 e UC02.06). Exclusivo do
// Administrador. Toda mudança passa pela mesma trava (`adm:modulos`) e relê o `ativo` do módulo
// depois dela: uma ativação de funcionalidade não escapa da desativação do módulo feita ao mesmo
// tempo (D-P9-7).
export type DepsModulos = { cliente: PrismaClient };

const FUNCIONALIDADE = 'adm.modulos';
const TRAVA = 'adm:modulos';

export type FuncionalidadeDoModulo = { codigo: string; nome: string; grupo: string; ativo: boolean };
export type ModuloComFuncionalidades = { codigo: string; nome: string; ativo: boolean; funcionalidades: FuncionalidadeDoModulo[] };
export type Alternancia = { codigo: string; ativo: boolean };

// O módulo não é por TP: o Histórico sai sem unidade.
const contextoAuditoria = (ctx: ContextoRequisicao): ContextoAuditoria => ({
  usuarioId: ctx.usuarioId,
  usuarioRotulo: ctx.usuarioRotulo,
  sessaoUid: ctx.sessaoUid,
  ip: ctx.ip,
  unidadeId: null,
});

const recusa = (mensagem: string) => falha([{ campo: '_', mensagem }]);

// Desativar derruba as sessões de todos menos quem executou (D-P9-8; RN0043, RN0044): muda só a
// versão de acesso, nunca a `versao` do usuário (não gera conflito falso nas telas de usuário). O
// provedor de contexto encerra as sessões na próxima requisição, com o Histórico do UC02.15.
// A trava dos administradores antes do UPDATE em massa serializa com alterarPerfil e alterarUsuario,
// que a pegam primeiro: sem ela, dois UPDATEs de acessoVersao em ordens diferentes podiam dar impasse.
async function desconectarOutros(tx: TxCliente, ctx: ContextoRequisicao): Promise<void> {
  await travarRecurso(tx, 'adm:administradores');
  await tx.usuario.updateMany({ where: { id: { not: ctx.usuarioId } }, data: { acessoVersao: { increment: 1 } } });
}

// Módulos por ordem, cada um com as funcionalidades dele (RN0047), inclusive as fora do menu.
export async function listarModulos(ctx: ContextoRequisicao, deps: Partial<DepsModulos> = {}): Promise<ModuloComFuncionalidades[]> {
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const cliente = deps.cliente ?? prisma;
  const modulos = await cliente.modulo.findMany({
    include: { funcionalidades: { select: { codigo: true, nome: true, grupo: true, ativo: true }, orderBy: [{ ordem: 'asc' }, { codigo: 'asc' }] } },
    orderBy: { ordem: 'asc' },
  });
  return modulos.map((m) => ({ codigo: m.codigo, nome: m.nome, ativo: m.ativo, funcionalidades: m.funcionalidades }));
}

// UC02.05. Ativar não ativa as funcionalidades (RN0033) nem desconecta ninguém (RN0041); desativar
// desativa as funcionalidades do módulo na mesma transação (RN0034) e desconecta os outros (RN0043).
export async function alterarModulo(ctx: ContextoRequisicao, entrada: Alternancia, deps: Partial<DepsModulos> = {}): Promise<Resultado<{ alterado: boolean }>> {
  exigir(ctx, FUNCIONALIDADE, 'alterar');
  const cliente = deps.cliente ?? prisma;
  if (!entrada.ativo && !podeDesativarModulo(entrada.codigo)) return recusa(MENSAGENS_MODULOS.MODULO_PROTEGIDO);
  return cliente.$transaction(async (tx) => {
    await travarRecurso(tx, TRAVA);
    const modulo = await tx.modulo.findUnique({ where: { codigo: entrada.codigo } });
    if (!modulo) throw new ErroDominio('adm.modulo_inexistente', MENSAGENS_MODULOS.MODULO_INEXISTENTE);
    // Já no estado pedido (tela desatualizada ou clique repetido): nada a gravar.
    if (modulo.ativo === entrada.ativo) return ok({ alterado: false });
    await tx.modulo.update({ where: { codigo: modulo.codigo }, data: { ativo: entrada.ativo } });
    let desativadas: string[] = [];
    if (!entrada.ativo) {
      const ativas = await tx.funcionalidade.findMany({ where: { moduloCodigo: modulo.codigo, ativo: true }, select: { codigo: true }, orderBy: { codigo: 'asc' } });
      desativadas = ativas.map((f) => f.codigo);
      await tx.funcionalidade.updateMany({ where: { moduloCodigo: modulo.codigo, ativo: true }, data: { ativo: false } });
      await desconectarOutros(tx, ctx);
    }
    await auditar(tx, {
      contexto: contextoAuditoria(ctx),
      funcionalidade: FUNCIONALIDADE,
      tipo: 'ALTERACAO',
      registroId: modulo.codigo,
      descricao: descricaoModulo(entrada.ativo, modulo.nome),
      antes: { ativo: modulo.ativo },
      depois: entrada.ativo ? { ativo: true } : { ativo: false, funcionalidadesDesativadas: desativadas },
    });
    return ok({ alterado: true });
  });
}

// UC02.06. Só com o módulo ativo (pré-condição do UC02.06); desativar desconecta os outros (RN0044,
// D-P9-8); ativar não desconecta ninguém (RN0042).
export async function alterarFuncionalidade(ctx: ContextoRequisicao, entrada: Alternancia, deps: Partial<DepsModulos> = {}): Promise<Resultado<{ alterado: boolean }>> {
  exigir(ctx, FUNCIONALIDADE, 'alterar');
  const cliente = deps.cliente ?? prisma;
  return cliente.$transaction(async (tx) => {
    await travarRecurso(tx, TRAVA);
    const funcionalidade = await tx.funcionalidade.findUnique({ where: { codigo: entrada.codigo }, include: { modulo: { select: { ativo: true } } } });
    if (!funcionalidade) throw new ErroDominio('adm.funcionalidade_inexistente', MENSAGENS_MODULOS.FUNCIONALIDADE_INEXISTENTE);
    if (!entrada.ativo && !podeDesativarModulo(funcionalidade.moduloCodigo)) return recusa(MENSAGENS_MODULOS.FUNCIONALIDADE_PROTEGIDA);
    if (entrada.ativo && !funcionalidade.modulo.ativo) return recusa(MENSAGENS_MODULOS.MODULO_INATIVO);
    if (funcionalidade.ativo === entrada.ativo) return ok({ alterado: false });
    await tx.funcionalidade.update({ where: { codigo: funcionalidade.codigo }, data: { ativo: entrada.ativo } });
    if (!entrada.ativo) await desconectarOutros(tx, ctx);
    await auditar(tx, {
      contexto: contextoAuditoria(ctx),
      funcionalidade: FUNCIONALIDADE,
      tipo: 'ALTERACAO',
      registroId: funcionalidade.codigo,
      descricao: descricaoFuncionalidade(entrada.ativo, funcionalidade.nome),
      antes: { ativo: funcionalidade.ativo },
      depois: { ativo: entrada.ativo },
    });
    return ok({ alterado: true });
  });
}
