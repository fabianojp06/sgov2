import 'server-only';
import { z } from 'zod';
import { listarEmpregados } from '@/modules/orc';
import type { ContextoRequisicao } from '@/shared/authz';
import { ErroIA, servicoIA, type ServicoIA } from '@/shared/ia';
import { falha, ok, type Resultado } from '@/shared/kernel';
import {
  agregarQuadro,
  conferirAnalise,
  MAXIMO_ITEM,
  MAXIMO_RESUMO,
  mensagemQuadro,
  totalDePostos,
  type AnaliseQuadro,
  type PropostaEntrada,
  type QuadroPessoal,
} from '../domain/quadro-pessoal';
import { CASO_QUADRO_PESSOAL } from './ia-casos';

// Análise do quadro de pessoal (US-107, IA-07). Só leitura: os empregados vêm do listarEmpregados do orc
// (US-070), que confere orc.empregados:consultar, aplica a RLS dos TPs do usuário e só traz o custo para
// quem o vê (D-P20-5). O rel agrega em código (domain/quadro-pessoal) e manda à IA só os agregados; a
// tela mostra os mesmos agregados, para conferir o que foi enviado. Nada é gravado além do registro
// da chamada (ia_chamada, pela governança da US-019).

export const TEMPO_LIMITE_QUADRO_MS = 60_000;
const PERMISSAO_IA = `${CASO_QUADRO_PESSOAL.funcionalidade}:executar`;
export const PERMISSAO_EMPREGADOS = 'orc.empregados:consultar';

export const MENSAGENS_QUADRO = {
  SEM_EMPREGADOS_ORC: 'O seu perfil não consulta os empregados das propostas (Cadastros › Propostas › Empregados). Contate o Administrador.',
  SEM_PESSOAL: 'Nenhuma proposta com empregados lançados para os filtros escolhidos.',
  FILTROS_INVALIDOS: 'Filtros inválidos. Revise o tipo e o texto da proposta.',
  TEMPO_ESGOTADO: 'A IA demorou demais para responder. Tente de novo.',
} as const;

const SAIDA = z.object({
  resumo: z.string().max(MAXIMO_RESUMO),
  // Sem teto no número de itens: a conferência corta em MAXIMO_ITENS (7 destaques não viram erro).
  destaques: z.array(z.string().max(MAXIMO_ITEM)),
  alertas: z.array(z.string().max(MAXIMO_ITEM)),
});

const FILTROS = z.object({
  tipo: z.enum(['', 'CONTRATO', 'TERMO_PARCERIA']).optional(),
  proposta: z.string().max(100).optional(),
});
export type FiltrosQuadro = z.infer<typeof FILTROS>;

type ListarEmpregados = typeof listarEmpregados;
export type DepsQuadro = { listarEmpregados: ListarEmpregados; ia: ServicoIA; sinalIa: () => AbortSignal };

const resolver = (d: Partial<DepsQuadro>): DepsQuadro => ({
  listarEmpregados: d.listarEmpregados ?? listarEmpregados,
  ia: d.ia ?? servicoIA,
  sinalIa: d.sinalIa ?? (() => AbortSignal.timeout(TEMPO_LIMITE_QUADRO_MS)),
});

const erro = (mensagem: string, campo = '_'): Resultado<never> => falha([{ campo, mensagem }]);
const tempoEsgotado = (sinal: AbortSignal) => sinal.aborted && (sinal.reason as { name?: unknown } | undefined)?.name === 'TimeoutError';

/** Os filtros da tela, validados; inválidos viram null. */
export function lerFiltrosQuadro(bruto: unknown): FiltrosQuadro | null {
  const r = FILTROS.safeParse(bruto);
  return r.success ? r.data : null;
}

/** Os agregados para a tela e para a IA (só os campos de que o domínio precisa saem do orc). */
export async function obterQuadroPessoal(ctx: ContextoRequisicao, filtros: FiltrosQuadro, deps: Partial<Pick<DepsQuadro, 'listarEmpregados'>> = {}): Promise<Resultado<QuadroPessoal>> {
  if (!ctx.permissoes.has(PERMISSAO_EMPREGADOS)) return erro(MENSAGENS_QUADRO.SEM_EMPREGADOS_ORC);
  const blocos = await (deps.listarEmpregados ?? listarEmpregados)(ctx, { tipo: filtros.tipo || undefined, proposta: filtros.proposta?.trim() || undefined });
  const entrada: PropostaEntrada[] = blocos.map((b) => ({
    numero: b.numero,
    tipo: b.tipo,
    situacao: b.situacao,
    vigencia: b.vigencia,
    veCusto: b.veCusto,
    grupos: b.grupos.map((g) => ({
      empregados: g.empregados.map((e) => ({ categoria: e.categoria, avisos: e.avisos, nome: e.nome, cargo: e.cargo, inicio: e.inicio, fim: e.fim, custoPeriodo: e.custoPeriodo })),
    })),
  }));
  return ok(agregarQuadro(entrada));
}

/** O botão da análise aparece? A permissão do caso, a chave geral, o caso ativo e os tetos (sem reservar nem registrar). */
export function analiseQuadroLiberada(ctx: ContextoRequisicao, deps: Partial<Pick<DepsQuadro, 'ia'>> = {}): Promise<boolean> {
  return (deps.ia ?? servicoIA).disponivel(ctx, CASO_QUADRO_PESSOAL);
}

export async function analisarQuadroPessoal(
  ctx: ContextoRequisicao,
  bruto: unknown,
  depsParciais: Partial<DepsQuadro> = {},
): Promise<Resultado<{ analise: AnaliseQuadro; quadro: QuadroPessoal }>> {
  // A governança também confere; aqui, antes de qualquer leitura, com a mensagem do ErroIA.
  if (!ctx.permissoes.has(PERMISSAO_IA)) return erro(new ErroIA('ia.sem_permissao').message);
  const filtros = lerFiltrosQuadro(bruto);
  if (!filtros) return erro(MENSAGENS_QUADRO.FILTROS_INVALIDOS);
  const deps = resolver(depsParciais);
  // Caso desligado ou teto estourado: recusa antes da leitura, que é a parte cara (revisão 12.12, DoS).
  if (!(await deps.ia.disponivel(ctx, CASO_QUADRO_PESSOAL))) return erro(new ErroIA('ia.desligada').message);
  const lido = await obterQuadroPessoal(ctx, filtros, deps);
  if (!lido.ok) return lido;
  const quadro = lido.valor;
  if (totalDePostos(quadro) === 0) return erro(MENSAGENS_QUADRO.SEM_PESSOAL);

  const sinal = deps.sinalIa();
  try {
    const r = await deps.ia.gerarEstruturado(ctx, CASO_QUADRO_PESSOAL, mensagemQuadro(quadro), SAIDA, sinal);
    return ok({ analise: conferirAnalise(r.valor), quadro });
  } catch (x) {
    // definirAcao só traduz ErroDominio: o ErroIA vira aqui a mensagem fixa dele (sem detalhe do provedor).
    if (!(x instanceof ErroIA)) throw x;
    return erro(x.codigo === 'ia.cancelada' && tempoEsgotado(sinal) ? MENSAGENS_QUADRO.TEMPO_ESGOTADO : x.message);
  }
}
