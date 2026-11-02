import { randomUUID } from 'node:crypto';
import { Prisma } from '@/generated/prisma/client';
import { auditar, type ContextoAuditoria } from '@/shared/audit';
import type { TxCliente } from '@/shared/db';
import { ErroDominio } from '@/shared/kernel';
import { planejarCarga, type Atual } from '../domain/carga';
import type { ErroLinha, LinhaPlanoValidada } from '../domain/plano-contas';

// Núcleo do merge do plano de contas (plano do P4, R5, R6 e M-n3). Não confere papel nem lote:
// isso é da casca do worker (processador-cargas.ts). A seed chama este mesmo núcleo com o tx do
// migrator. R22/E-N4: sem @/shared/authz nem next/.

const FUNCIONALIDADE = 'cad.plano_contas';

export type ResultadoCarga = { incluidas: number; alteradas: number; inativadas: number; inalteradas: number; avisos: readonly ErroLinha[] };

/** Erros da R5 que dependem do banco, por linha. A mensagem não cita valores. */
export class ErroCargaLinhas extends ErroDominio {
  constructor(readonly erros: readonly ErroLinha[]) {
    super('cad.carga_com_erros', 'A carga tem erros por linha.', { quantidade: erros.length });
    this.name = 'ErroCargaLinhas';
  }
}

type ContaBanco = { id: string; classificacao: string; codigoReduzido: string | null; tipo: string; descricao: string; ativa: boolean };

export function comoAtual(c: Pick<ContaBanco, 'classificacao' | 'codigoReduzido' | 'tipo' | 'descricao' | 'ativa'>): Atual {
  return { classificacao: c.classificacao, codigoReduzido: c.codigoReduzido, tipo: c.tipo, descricao: c.descricao, ativo: c.ativa };
}

export function comoNova(l: LinhaPlanoValidada): Atual {
  return { classificacao: l.classificacao, codigoReduzido: l.codigoReduzido, tipo: l.tipo, descricao: l.descricao, ativo: true, linha: l.linha };
}

/** Lê o plano de contas atual no formato do planejarCarga. */
export async function lerContasAtuais(tx: TxCliente): Promise<Atual[]> {
  const contas = await tx.contaContabil.findMany({
    select: { classificacao: true, codigoReduzido: true, tipo: true, descricao: true, ativa: true },
  });
  return contas.map(comoAtual);
}

/**
 * Aplica as linhas validadas sobre o plano de contas, na ordem do M-n3: inativa as ausentes,
 * reativa as que voltam, inclui as novas e atualiza as descrições. Cada mudança é auditada com o
 * contexto do lote; o que não muda não gera Histórico nem toca `atualizado_em` (M-n2). Os triggers
 * deferidos da árvore são conferidos no fim (SET CONSTRAINTS ALL IMMEDIATE).
 */
export async function aplicarCarga(
  tx: TxCliente,
  contexto: ContextoAuditoria,
  carga: { id: string; tipo: 'PLANO_CONTAS' },
  linhas: readonly LinhaPlanoValidada[],
): Promise<ResultadoCarga> {
  const banco: ContaBanco[] = await tx.contaContabil.findMany({
    select: { id: true, classificacao: true, codigoReduzido: true, tipo: true, descricao: true, ativa: true },
  });
  const plano = planejarCarga(banco.map(comoAtual), linhas.map(comoNova));
  if (plano.erros.length > 0) throw new ErroCargaLinhas(plano.erros);
  // A seed audita como "Sistema" (contexto sem usuário); a carga do worker, com o usuário do lote.
  const origem = contexto.usuarioId === null ? 'SISTEMA' : 'USUARIO';

  const porClassificacao = new Map(banco.map((c) => [c.classificacao, c]));
  const agora = new Date();

  for (const classificacao of plano.inativar) {
    const antes = porClassificacao.get(classificacao)!;
    await tx.contaContabil.update({ where: { id: antes.id }, data: { ativa: false, inativadaEm: agora, cargaId: carga.id } });
    await auditar(tx, {
      contexto,
      origem,
      funcionalidade: FUNCIONALIDADE,
      tipo: 'ALTERACAO',
      registroId: classificacao,
      descricao: `Conta ${classificacao} inativada pela carga`,
      antes: { ativa: true },
      depois: { ativa: false },
    });
  }

  for (const r of plano.reativar) {
    const antes = porClassificacao.get(r.classificacao)!;
    await tx.contaContabil.update({ where: { id: antes.id }, data: { ativa: true, inativadaEm: null, descricao: r.descricao, cargaId: carga.id } });
    await auditar(tx, {
      contexto,
      origem,
      funcionalidade: FUNCIONALIDADE,
      tipo: 'ALTERACAO',
      registroId: r.classificacao,
      descricao: `Conta ${r.classificacao} reativada pela carga`,
      antes: { ativa: false, descricao: antes.descricao },
      depois: { ativa: true, descricao: r.descricao },
    });
  }

  if (plano.incluir.length > 0) {
    const porLinha = new Map(linhas.map((l) => [l.classificacao, l]));
    const ids = new Map(banco.map((c) => [c.classificacao, c.id]));
    for (const n of plano.incluir) ids.set(n.classificacao, randomUUID());
    const dados = plano.incluir.map((n) => {
      const l = porLinha.get(n.classificacao)!;
      const paiId = l.classificacaoPai === null ? null : ids.get(l.classificacaoPai);
      if (paiId === undefined) throw new ErroCargaLinhas([{ linha: l.linha, coluna: 'Conta Superior', mensagem: 'A conta superior não existe.' }]);
      return {
        id: ids.get(n.classificacao)!,
        classificacao: l.classificacao,
        codigoReduzido: l.codigoReduzido,
        descricao: l.descricao,
        nivel: l.nivel,
        tipo: l.tipo,
        paiId,
        cargaId: carga.id,
      };
    });
    await tx.contaContabil.createMany({ data: dados });
    for (const d of dados) {
      await auditar(tx, {
        contexto,
        origem,
        funcionalidade: FUNCIONALIDADE,
        tipo: 'INSERCAO',
        registroId: d.classificacao,
        descricao: `Conta ${d.classificacao} incluída pela carga`,
        depois: { classificacao: d.classificacao, codigoReduzido: d.codigoReduzido, descricao: d.descricao, nivel: d.nivel, tipo: d.tipo },
      });
    }
  }

  if (plano.alterarDescricao.length > 0) {
    const valores = Prisma.join(plano.alterarDescricao.map((a) => Prisma.sql`(${a.classificacao}, ${a.descricao})`));
    await tx.$executeRaw`UPDATE "conta_contabil" AS c SET "descricao" = v.descricao, "carga_id" = ${carga.id}::uuid
      FROM (VALUES ${valores}) AS v(classificacao, descricao) WHERE c."classificacao" = v.classificacao`;
    for (const a of plano.alterarDescricao) {
      await auditar(tx, {
        contexto,
        origem,
        funcionalidade: FUNCIONALIDADE,
        tipo: 'ALTERACAO',
        registroId: a.classificacao,
        descricao: `Descrição da conta ${a.classificacao} alterada pela carga`,
        antes: { descricao: porClassificacao.get(a.classificacao)!.descricao },
        depois: { descricao: a.descricao },
      });
    }
  }

  await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
  return {
    incluidas: plano.incluir.length,
    alteradas: plano.alterarDescricao.length + plano.reativar.length,
    inativadas: plano.inativar.length,
    inalteradas: plano.inalteradas,
    avisos: plano.avisos,
  };
}
