import { z } from 'zod';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { registrarNoOutbox } from '@/shared/filas';
import { ErroDominio, falha, ok, type Resultado } from '@/shared/kernel';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { AVISO_SO_POSICOES, filtrarAchados, REVISAO_PARADA_MS, type Achado, type AlcanceRevisao, type RevisaoTela, type SituacaoRevisao } from '../domain/revisor-regras';
import { travarExercicio } from './calculo-linhas';
import { resolverDeps, type DepsOrc } from './deps';
import { exigirSemEscopo } from './escopo';
import { FILA_REVISAO } from './revisor-processamento';

// Revisor de consistência antes do envio (US-064; plano do P14, Task 3 e D-P14-6). A GFIN pede em
// /orc/aprovacao (orc.aprovacao:executar, sem CC de escopo, só Em Elaboração); a revisão nasce PENDENTE
// e o worker a processa (processarRevisao). O revisor não bloqueia o envio.

const FUNCIONALIDADE = 'orc.aprovacao';
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
          where: { exercicioId: ex.id, situacao: 'PENDENTE', versaoExercicio: ex.versao, criadoEm: { gt: new Date(deps.agora().getTime() - REVISAO_PARADA_MS) } },
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

const alcance = (ctx: ContextoRequisicao): AlcanceRevisao => ({
  pacotes: ctx.permissoes.has('orc.pacotes:consultar'),
  posicoes: ctx.permissoes.has('orc.posicoes:consultar'),
  // D-P12-3: o salário (e o total de pessoal, que o revela) só para quem inclui ou altera posição.
  salario: ctx.permissoes.has('orc.posicoes:incluir') || ctx.permissoes.has('orc.posicoes:alterar'),
  // R24 (plano do P15, D-P15-4): a faixa de mercado do cargo é dado de cad.salarios.
  salariosCargo: ctx.permissoes.has('cad.salarios:consultar'),
});

/** Avisos para quem vê: o marcado só para quem consulta posições perde o prefixo ou sai (B3). */
function avisosPara(avisos: readonly string[], a: AlcanceRevisao): string[] {
  return avisos.flatMap((x) => (!x.startsWith(AVISO_SO_POSICOES) ? [x] : a.posicoes ? [x.slice(AVISO_SO_POSICOES.length)] : []));
}

const ACHADO = z.object({
  origem: z.enum(['REGRA', 'IA']),
  tipo: z.string(),
  texto: z.string(),
  links: z.array(
    z.object({
      rotulo: z.string(),
      href: z.string().startsWith('/orc/'),
      tipo: z.enum(['pacote', 'posicao', 'par']),
      pessoal: z.boolean().optional(),
      // Sem isto o Zod descartaria a marca na leitura e o achado da R5 vazaria (D-P15-4).
      salario: z.boolean().optional(),
    }),
  ),
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
  const parada = r.situacao === 'PENDENTE' && deps.agora().getTime() - r.criadoEm.getTime() > REVISAO_PARADA_MS;
  const lidos = z.array(ACHADO).safeParse(r.achados);
  const quem = alcance(ctx);
  return {
    situacao: parada ? 'FALHOU' : (r.situacao as SituacaoRevisao),
    // Só o que quem vê pode consultar (a revisão foi feita com o alcance de quem pediu).
    achados: lidos.success ? filtrarAchados(lidos.data as Achado[], quem) : [],
    avisos: parada ? [MENSAGENS_ORC.REVISAO_PARADA] : avisosPara(r.avisos, quem),
    desatualizada: r.versaoExercicio !== ex.versao,
    concluidaEm: r.concluidoEm,
  };
}
