import 'server-only';
import { z } from 'zod';
import { listarArvoreCentrosCusto, type NoCentroCusto } from '@/modules/cad';
import { listarEmpregados, listarExercicios, listarPosicoes } from '@/modules/orc';
import { prisma } from '@/shared/db';
import type { ContextoRequisicao } from '@/shared/authz';
import { ErroIA, servicoIA, type ServicoIA } from '@/shared/ia';
import { ErroPermissao } from '@/shared/authz';
import { ErroDominio, falha, ok, type Resultado } from '@/shared/kernel';
import {
  agregarQuadro,
  conferirAnalise,
  MAXIMO_LEITURA,
  MAXIMO_ITEM,
  MAXIMO_RESUMO,
  mensagemQuadro,
  totalDePostos,
  type AnaliseQuadro,
  type PropostaEntrada,
  type QuadroPessoal,
} from '../domain/quadro-pessoal';
import { agregarAdmCentral, type ExercicioEntrada, type QuadroAdmCentral } from '../domain/quadro-adm-central';
import { CASO_QUADRO_PESSOAL } from './ia-casos';

// Análise do quadro de pessoal (US-107, IA-07). Só leitura: os empregados vêm do listarEmpregados do orc
// (US-070), que confere orc.empregados:consultar, aplica a RLS dos TPs do usuário e só traz o custo para
// quem o vê (D-P20-5). O rel agrega em código (domain/quadro-pessoal) e manda à IA só os agregados; a
// tela mostra os mesmos agregados, para conferir o que foi enviado. Nada é gravado além do registro
// da chamada (ia_chamada, pela governança da US-019). Parte 2 (D-107-2): as posições orçadas da
// Administração Central por diretoria, pelo listarPosicoes do orc (orc.posicoes:consultar, com o escopo do
// Gestor de Diretoria), no exercício escolhido e no anterior.

export const TEMPO_LIMITE_QUADRO_MS = 60_000;
const PERMISSAO_IA = `${CASO_QUADRO_PESSOAL.funcionalidade}:executar`;
export const PERMISSAO_EMPREGADOS = 'orc.empregados:consultar';
export const PERMISSAO_POSICOES = 'orc.posicoes:consultar';

export const MENSAGENS_QUADRO = {
  SEM_EMPREGADOS_ORC: 'O seu perfil não consulta os empregados das propostas (Cadastros › Propostas › Empregados). Contate o Administrador.',
  SEM_ACESSO: 'O seu perfil não consulta os empregados das propostas nem as posições orçadas da Administração Central. Contate o Administrador.',
  EXERCICIO_INEXISTENTE: (ano: number) => `Exercício ${ano} não encontrado na Administração Central.`,
  SEM_PESSOAL: 'Nenhuma proposta com empregados lançados para os filtros escolhidos.',
  SEM_DADOS: 'Nada para analisar: nenhuma proposta com empregados nem posição orçada da Administração Central para os filtros escolhidos.',
  FILTROS_INVALIDOS: 'Filtros inválidos. Revise o tipo, o texto da proposta e o exercício.',
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
  ano: z.union([z.literal(''), z.string().regex(/^\d{4}$/)]).optional(),
});
export type FiltrosQuadro = z.infer<typeof FILTROS>;

type ListarEmpregados = typeof listarEmpregados;
export type LeituraAdmCentral = {
  listarExercicios: (ctx: ContextoRequisicao) => Promise<readonly { id: string; ano: number; rotuloSituacao: string }[]>;
  listarPosicoes: (ctx: ContextoRequisicao, exercicioId: string) => Promise<{ posicoes: readonly ExercicioEntrada['posicoes'][number][]; veSalario: boolean }>;
  centrosCusto: () => Promise<readonly NoCentroCusto[]>;
};
export type DepsQuadro = { listarEmpregados: ListarEmpregados; admCentral: LeituraAdmCentral; ia: ServicoIA; sinalIa: () => AbortSignal };

const ADM_CENTRAL_REAL: LeituraAdmCentral = {
  listarExercicios: (ctx) => listarExercicios(ctx),
  listarPosicoes: (ctx, id) => listarPosicoes(ctx, id),
  centrosCusto: () => listarArvoreCentrosCusto(prisma, { incluirInativos: true }),
};

const resolver = (d: Partial<DepsQuadro>): DepsQuadro => ({
  listarEmpregados: d.listarEmpregados ?? listarEmpregados,
  admCentral: d.admCentral ?? ADM_CENTRAL_REAL,
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
  // Teto de leitura no orc (#480): o motor de custo roda só para as propostas lidas (revisão 12.12, DoS).
  const blocos = await (deps.listarEmpregados ?? listarEmpregados)(ctx, {
    tipo: filtros.tipo || undefined,
    proposta: filtros.proposta?.trim() || undefined,
    maximo: MAXIMO_LEITURA,
  });
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
  return ok(agregarQuadro(entrada, blocos.length >= MAXIMO_LEITURA));
}

/** `anoPedidoAusente`: o exercício pedido não existe; a tela mostra o mais recente e avisa. */
export type TelaAdmCentral = { anos: readonly number[]; ano: number; anoPedidoAusente: number | null; quadro: QuadroAdmCentral };

function nomesDosCcs(raizes: readonly NoCentroCusto[]): Map<string, string> {
  const nomes = new Map<string, string>();
  const visitar = (n: NoCentroCusto) => {
    nomes.set(n.classificacao, n.descricao);
    n.filhos.forEach(visitar);
  };
  raizes.forEach(visitar);
  return nomes;
}

/**
 * Parte 2: as posições da Administração Central por diretoria, no exercício pedido (ou no mais recente) e no
 * anterior. Null quando o perfil não consulta as posições ou não há exercício: a seção some da tela.
 */
export async function obterQuadroAdmCentral(ctx: ContextoRequisicao, ano: number | null, deps: Partial<Pick<DepsQuadro, 'admCentral'>> = {}): Promise<TelaAdmCentral | null> {
  if (!ctx.permissoes.has(PERMISSAO_POSICOES)) return null;
  const leitura = deps.admCentral ?? ADM_CENTRAL_REAL;
  try {
    const exercicios = await leitura.listarExercicios(ctx);
    const pedido = ano === null ? undefined : exercicios.find((e) => e.ano === ano);
    const atual = pedido ?? [...exercicios].sort((a, b) => b.ano - a.ano)[0];
    if (!atual) return null;
    const anterior = exercicios.find((e) => e.ano === atual.ano - 1);
    const lidos = await Promise.all((anterior ? [anterior, atual] : [atual]).map(async (e) => ({ e, l: await leitura.listarPosicoes(ctx, e.id) })));
    const entrada: ExercicioEntrada[] = lidos.map(({ e, l }) => ({
      ano: e.ano,
      situacao: e.rotuloSituacao,
      veSalario: l.veSalario,
      posicoes: l.posicoes.map((p) => ({ cc: p.cc, quantidade: p.quantidade, mesInicio: p.mesInicio, mesSaida: p.mesSaida, valorAnual: p.valorAnual })),
    }));
    const nomes = nomesDosCcs(await leitura.centrosCusto());
    return {
      anos: exercicios.map((e) => e.ano).sort((a, b) => b - a),
      ano: atual.ano,
      anoPedidoAusente: ano !== null && !pedido ? ano : null,
      quadro: agregarAdmCentral(entrada, (cc) => nomes.get(cc) ?? cc),
    };
  } catch (x) {
    // Exercício excluído entre as leituras, escopo vazio etc.: a seção some, sem derrubar a página (revisão 12.12).
    if (x instanceof ErroDominio || x instanceof ErroPermissao) return null;
    throw x;
  }
}

const temPosicoes = (a: TelaAdmCentral | null) => a !== null && a.quadro.exercicios.some((e) => e.postos > 0);

/** O botão da análise aparece? A permissão do caso, a chave geral, o caso ativo e os tetos (sem reservar nem registrar). */
export function analiseQuadroLiberada(ctx: ContextoRequisicao, deps: Partial<Pick<DepsQuadro, 'ia'>> = {}): Promise<boolean> {
  return (deps.ia ?? servicoIA).disponivel(ctx, CASO_QUADRO_PESSOAL);
}

export type ResultadoAnalise = { analise: AnaliseQuadro; quadro: QuadroPessoal | null; admCentral: QuadroAdmCentral | null };

export async function analisarQuadroPessoal(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsQuadro> = {}): Promise<Resultado<ResultadoAnalise>> {
  // A governança também confere; aqui, antes de qualquer leitura, com a mensagem do ErroIA.
  if (!ctx.permissoes.has(PERMISSAO_IA)) return erro(new ErroIA('ia.sem_permissao').message);
  const filtros = lerFiltrosQuadro(bruto);
  if (!filtros) return erro(MENSAGENS_QUADRO.FILTROS_INVALIDOS);
  if (!ctx.permissoes.has(PERMISSAO_EMPREGADOS) && !ctx.permissoes.has(PERMISSAO_POSICOES)) return erro(MENSAGENS_QUADRO.SEM_ACESSO);
  const deps = resolver(depsParciais);
  // Caso desligado ou teto estourado: recusa antes da leitura, que é a parte cara (revisão 12.12, DoS).
  if (!(await deps.ia.disponivel(ctx, CASO_QUADRO_PESSOAL))) return erro(new ErroIA('ia.desligada').message);
  const lido = ctx.permissoes.has(PERMISSAO_EMPREGADOS) ? await obterQuadroPessoal(ctx, filtros, deps) : null;
  const quadro = lido?.ok && totalDePostos(lido.valor) > 0 ? lido.valor : null;
  const adm = await obterQuadroAdmCentral(ctx, filtros.ano ? Number(filtros.ano) : null, deps);
  // Na ação, exercício inexistente é recusado (a tela avisa e mostra o mais recente).
  if (adm?.anoPedidoAusente) return erro(MENSAGENS_QUADRO.EXERCICIO_INEXISTENTE(adm.anoPedidoAusente));
  const admCentral = temPosicoes(adm) ? adm!.quadro : null;
  if (!quadro && !admCentral) return erro(MENSAGENS_QUADRO.SEM_DADOS);

  const sinal = deps.sinalIa();
  try {
    const r = await deps.ia.gerarEstruturado(ctx, CASO_QUADRO_PESSOAL, mensagemQuadro(quadro, admCentral), SAIDA, sinal);
    return ok({ analise: conferirAnalise(r.valor), quadro, admCentral });
  } catch (x) {
    // definirAcao só traduz ErroDominio: o ErroIA vira aqui a mensagem fixa dele (sem detalhe do provedor).
    if (!(x instanceof ErroIA)) throw x;
    return erro(x.codigo === 'ia.cancelada' && tempoEsgotado(sinal) ? MENSAGENS_QUADRO.TEMPO_ESGOTADO : x.message);
  }
}
