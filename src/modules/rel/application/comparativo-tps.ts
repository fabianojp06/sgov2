import 'server-only';
import { z } from 'zod';
import { obterComparativoTps } from '@/modules/orc';
import type { ContextoRequisicao } from '@/shared/authz';
import { ErroIA, servicoIA, type ServicoIA } from '@/shared/ia';
import { falha, ok, type Resultado } from '@/shared/kernel';
import { compararTps, mensagemComparativo, type Comparativo, type TpEntrada } from '../domain/comparativo-tps';
import { conferirAnalise, MAXIMO_ITEM, MAXIMO_RESUMO, type AnaliseQuadro } from '../domain/quadro-pessoal';
import { CASO_COMPARATIVO_TPS } from './ia-casos';

// Comparativo entre TPs (US-106, IA-17). Só leitura: os números vêm do obterComparativoTps do orc (#513),
// que confere orc.consolidado:consultar, registra a CONSULTA no Histórico e lê todos os TPs numa transação
// somente leitura (o único caminho com vários TPs juntos, spec §6.7). O rel calcula os indicadores e os
// pontos fora da curva (domain/comparativo-tps) e manda à IA só esses agregados, para ela comentar.

export const TEMPO_LIMITE_COMPARATIVO_MS = 60_000;
const PERMISSAO_IA = `${CASO_COMPARATIVO_TPS.funcionalidade}:executar`;
export const PERMISSAO_CONSOLIDADO = 'orc.consolidado:consultar';

export const MENSAGENS_COMPARATIVO = {
  SEM_CONSOLIDADO: 'O seu perfil não consulta o Consolidado dos TPs (Administração Central). Contate o Administrador.',
  SEM_TPS: 'Nenhum Termo de Parceria para comparar.',
  TEMPO_ESGOTADO: 'A IA demorou demais para responder. Tente de novo.',
} as const;

const SAIDA = z.object({
  resumo: z.string().max(MAXIMO_RESUMO),
  // Sem teto no número de itens: a conferência corta em MAXIMO_ITENS.
  destaques: z.array(z.string().max(MAXIMO_ITEM)),
  alertas: z.array(z.string().max(MAXIMO_ITEM)),
});

type LerComparativo = (ctx: ContextoRequisicao) => Promise<readonly TpEntrada[]>;
export type DepsComparativo = { ler: LerComparativo; ia: ServicoIA; sinalIa: () => AbortSignal };

// A porta do orc devolve o mesmo formato do TpEntrada (o rel só copia os campos de que precisa).
const LER_REAL: LerComparativo = async (ctx) =>
  (await obterComparativoTps(ctx)).map((t) => ({
    numero: t.numero,
    tipo: t.tipo,
    situacao: t.situacao,
    oficial: t.oficial,
    vigencia: t.vigencia,
    valorGlobal: t.valorGlobal,
    porCategoria: t.porCategoria,
    metas: t.metas,
    realizado: t.realizado,
    postos: t.postos,
  }));

const resolver = (d: Partial<DepsComparativo>): DepsComparativo => ({
  ler: d.ler ?? LER_REAL,
  ia: d.ia ?? servicoIA,
  sinalIa: d.sinalIa ?? (() => AbortSignal.timeout(TEMPO_LIMITE_COMPARATIVO_MS)),
});

const erro = (mensagem: string): Resultado<never> => falha([{ campo: '_', mensagem }]);
const tempoEsgotado = (sinal: AbortSignal) => sinal.aborted && (sinal.reason as { name?: unknown } | undefined)?.name === 'TimeoutError';

/** O comparativo para a tela (e para a IA). Sem a permissão do consolidado, a mensagem, sem ler nada. */
export async function obterComparativo(ctx: ContextoRequisicao, deps: Partial<Pick<DepsComparativo, 'ler'>> = {}): Promise<Resultado<Comparativo>> {
  if (!ctx.permissoes.has(PERMISSAO_CONSOLIDADO)) return erro(MENSAGENS_COMPARATIVO.SEM_CONSOLIDADO);
  return ok(compararTps(await (deps.ler ?? LER_REAL)(ctx)));
}

/** O botão dos comentários aparece? A permissão do caso, a chave geral, o caso ativo e os tetos. */
export function comentariosComparativoLiberados(ctx: ContextoRequisicao, deps: Partial<Pick<DepsComparativo, 'ia'>> = {}): Promise<boolean> {
  return (deps.ia ?? servicoIA).disponivel(ctx, CASO_COMPARATIVO_TPS);
}

export async function comentarComparativo(
  ctx: ContextoRequisicao,
  depsParciais: Partial<DepsComparativo> = {},
): Promise<Resultado<{ analise: AnaliseQuadro; comparativo: Comparativo }>> {
  if (!ctx.permissoes.has(PERMISSAO_IA)) return erro(new ErroIA('ia.sem_permissao').message);
  if (!ctx.permissoes.has(PERMISSAO_CONSOLIDADO)) return erro(MENSAGENS_COMPARATIVO.SEM_CONSOLIDADO);
  const deps = resolver(depsParciais);
  // Caso desligado ou teto estourado: recusa antes da leitura (que também grava a CONSULTA no Histórico).
  if (!(await deps.ia.disponivel(ctx, CASO_COMPARATIVO_TPS))) return erro(new ErroIA('ia.desligada').message);
  const lido = await obterComparativo(ctx, deps);
  if (!lido.ok) return lido;
  if (lido.valor.tps.length === 0) return erro(MENSAGENS_COMPARATIVO.SEM_TPS);

  const sinal = deps.sinalIa();
  try {
    const r = await deps.ia.gerarEstruturado(ctx, CASO_COMPARATIVO_TPS, mensagemComparativo(lido.valor), SAIDA, sinal);
    return ok({ analise: conferirAnalise(r.valor), comparativo: lido.valor });
  } catch (x) {
    // definirAcao só traduz ErroDominio: o ErroIA vira aqui a mensagem fixa dele (sem detalhe do provedor).
    if (!(x instanceof ErroIA)) throw x;
    return erro(x.codigo === 'ia.cancelada' && tempoEsgotado(sinal) ? MENSAGENS_COMPARATIVO.TEMPO_ESGOTADO : x.message);
  }
}
