import { z } from 'zod';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { registrarNoOutbox } from '@/shared/filas';
import { ErroDominio, falha, ok, type Resultado } from '@/shared/kernel';
import { MENSAGENS_ORC } from '../domain/mensagens';
import type { Achado, RevisaoTela, SituacaoRevisao } from '../domain/revisor-regras';
import { travarExercicio } from './calculo-linhas';
import { resolverDeps, type DepsOrc } from './deps';
import { exigirSemEscopo } from './escopo';
import { FILA_REVISAO } from './revisor-processamento';

// Revisor de consistência antes do envio (US-064; plano do P14, Task 3 e D-P14-6). A GFIN pede em
// /orc/aprovacao (orc.aprovacao:executar, sem CC de escopo, só Em Elaboração); a revisão nasce PENDENTE
// e o worker a processa (processarRevisao). O revisor não bloqueia o envio.

const FUNCIONALIDADE = 'orc.aprovacao';
/** PENDENTE há mais tempo que isto: aparece como FALHOU e libera um pedido novo. */
export const MINUTOS_REVISAO_PARADA = 15;
const PARADA_MS = MINUTOS_REVISAO_PARADA * 60_000;
const ENTRADA = z.object({ id: z.string(), versao: z.coerce.number().int().min(0) }).strict();

class ErroPedido extends ErroDominio {
  constructor(readonly mensagem: string) {
    super('orc.revisao_recusada', mensagem);
  }
}

export async function pedirRevisao(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ revisaoId: string; ano: number }>> {
  exigir(ctx, FUNCIONALIDADE, 'executar');
  const deps = resolverDeps(depsParciais);
  await exigirSemEscopo(deps.cliente, ctx, deps, FUNCIONALIDADE, 'executar');
  const e = ENTRADA.safeParse(bruto);
  if (!e.success) return falha([{ campo: '_', mensagem: 'Dados inválidos. Recarregue a tela.' }]);
  const entrada = e.data;
  try {
    return ok(
      await deps.cliente.$transaction(async (tx) => {
        // A trava do exercício serializa pedidos simultâneos: dois cliques criam uma revisão só.
        const ex = await travarExercicio(tx, entrada.id);
        if (ex.versao !== entrada.versao) throw new ErroPedido(MENSAGENS_ORC.ALTERADO_POR_OUTRO);
        if (ex.situacao !== 'EM_ELABORACAO') throw new ErroPedido(MENSAGENS_ORC.REVISAO_SO_EM_ELABORACAO);
        const recente = await tx.revisaoOrcamento.findFirst({
          where: { exercicioId: ex.id, situacao: 'PENDENTE', criadoEm: { gt: new Date(deps.agora().getTime() - PARADA_MS) } },
          orderBy: { criadoEm: 'desc' },
          select: { id: true },
        });
        if (recente) return { revisaoId: recente.id, ano: ex.ano };
        // SQL explícito: o app só insere estas três colunas (GRANT por coluna); o resto vem do padrão.
        const [r] = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO orc_revisao (exercicio_id, versao_exercicio, solicitado_por)
          VALUES (${ex.id}::uuid, ${ex.versao}, ${ctx.usuarioId}::uuid) RETURNING id::text AS id`;
        if (!r) throw new Error('orc_revisao sem id');
        // Na mesma transação: só é publicada se a revisão foi gravada.
        await registrarNoOutbox(tx, FILA_REVISAO, { revisaoId: r.id });
        return { revisaoId: r.id, ano: ex.ano };
      }),
    );
  } catch (erro) {
    if (erro instanceof ErroPedido) return falha([{ campo: '_', mensagem: erro.mensagem }]);
    throw erro;
  }
}

const ACHADO = z.object({
  origem: z.enum(['REGRA', 'IA']),
  tipo: z.string(),
  texto: z.string(),
  links: z.array(z.object({ rotulo: z.string(), href: z.string().startsWith('/orc/') })),
});

/** A última revisão do exercício, para quem pode pedir; null sem revisão (ou com CC de escopo). */
export async function ultimaRevisao(ctx: ContextoRequisicao, exercicioId: string, depsParciais: Partial<DepsOrc> = {}): Promise<RevisaoTela | null> {
  exigir(ctx, FUNCIONALIDADE, 'executar');
  const deps = resolverDeps(depsParciais);
  if ((await deps.obterEscopo(deps.cliente, ctx.usuarioId)) !== null) return null;
  if (!z.uuid().safeParse(exercicioId).success) return null;
  const [r, ex] = await Promise.all([
    deps.cliente.revisaoOrcamento.findFirst({ where: { exercicioId }, orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }] }),
    deps.cliente.orcamentoExercicio.findUnique({ where: { id: exercicioId }, select: { versao: true } }),
  ]);
  if (!r || !ex) return null;
  const parada = r.situacao === 'PENDENTE' && deps.agora().getTime() - r.criadoEm.getTime() > PARADA_MS;
  const lidos = z.array(ACHADO).safeParse(r.achados);
  return {
    situacao: parada ? 'FALHOU' : (r.situacao as SituacaoRevisao),
    achados: lidos.success ? (lidos.data as Achado[]) : [],
    avisos: parada ? [MENSAGENS_ORC.REVISAO_PARADA] : r.avisos,
    desatualizada: r.versaoExercicio !== ex.versao,
    concluidaEm: r.concluidoEm,
  };
}
