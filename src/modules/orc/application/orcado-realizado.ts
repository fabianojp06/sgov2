import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { Dinheiro } from '@/shared/kernel';
import { emUnidade } from '@/shared/unidade';
import { competenciaParaTexto } from '../domain/empregado';
import { RAIZES_CONTAS_PESSOAL } from '../domain/planilha';
import { competenciasDaVigencia } from '../domain/rateio';
import { contextoAuditoria } from './calculo-linhas';
import { seriesDaVersao } from './cronograma';
import { resolverDeps, type DepsOrc } from './deps';
import { montarGradeOxr, type GradeOxr, type NoPlanoOxr } from './grade-oxr';
import { uuid } from './pessoal-comum';
import { lerRealizado } from './realizado';
import { vePessoal } from './totalizadores';

// Orçado x Realizado do TP (US-086, parte 1; OxR V2, seção 5; UC04.07; plano do P33). Só leitura. O orçado do mês é o
// cronograma de desembolso da última versão oficializada (D-P32-10), com a regra do pessoal do cronograma (D-P23-5);
// o realizado é o carregado (US-085), carga + ajustes lançados no mês (RN_OXR_008). Cada consulta vai ao Histórico com
// os filtros (RN_EO_006).

export const FUNCIONALIDADE_OXR = 'orc.oxr';
/** RNF_EO_002: até 24 meses por consulta [PROVISÓRIO, D-P33-3]. */
export const MESES_MAXIMOS_OXR = 24;
const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;

export const MENSAGENS_OXR = {
  SEM_TP: 'Selecione um Termo de Parceria para consultar.',
  TP_NAO_OFICIAL: 'O Orçado x Realizado só existe para Termo de Parceria oficializado.',
  PERIODO_INVALIDO: 'Período inválido: o inicial não pode passar do final.',
  PERIODO_LONGO: `Escolha um período de até ${MESES_MAXIMOS_OXR} meses.`,
  PERIODO_FORA: 'O período precisa estar dentro da vigência do Termo de Parceria.',
} as const;

export type FiltrosOxr = { proposta?: string | undefined; de?: string | undefined; ate?: string | undefined; conta?: string | undefined; zeradas?: boolean | undefined };

export type TelaOxr = {
  propostaId: string;
  unidadeId: string;
  numero: string;
  objeto: string;
  versaoOficial: number;
  vigencia: { inicio: string; fim: string };
  filtros: { de: string; ate: string; conta: string; zeradas: boolean };
  meses: readonly string[];
  grade: GradeOxr;
  pendencias: { quantidade: number; valor: Dinheiro };
  atualizadoEm: Date | null;
  /** As contas de pessoal ficaram de fora, no orçado e no realizado: só quem lança os empregados as vê (D-P23-5, D-P33-2). */
  semPessoal: boolean;
  pessoalNaoHomologado: boolean;
};
export type PropostaOxr = { id: string; numero: string; objeto: string };
export type ResultadoOxr = { propostas: readonly PropostaOxr[]; tela: TelaOxr | null; erro: string | null };

/** Os TPs oficializados que o usuário vê (pré-condição do UC), para o filtro. */
async function propostasOficiais(ctx: ContextoRequisicao, deps: DepsOrc): Promise<PropostaOxr[]> {
  const ps = await emUnidade(
    ctx,
    (tx) => tx.propostaTp.findMany({ where: { excluidaEm: null, versoes: { some: { snapshot: { isNot: null } } } }, include: { unidade: { select: { codigo: true } } } }),
    { cliente: deps.cliente },
  );
  return ps.map((p) => ({ id: p.id, numero: p.unidade.codigo, objeto: p.objeto })).sort((a, b) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));
}

const resposta = (propostas: readonly PropostaOxr[], tela: TelaOxr | null, erro: string | null): ResultadoOxr => ({ propostas, tela, erro });

/** UC Orçado x Realizado (OxR V2, fluxo principal e E1). Sem TP: só a lista; com filtro inválido: a lista e o erro. */
export async function obterOrcadoRealizado(ctx: ContextoRequisicao, filtros: FiltrosOxr, depsParciais: Partial<DepsOrc> = {}): Promise<ResultadoOxr> {
  return montarOrcadoRealizado(ctx, filtros, depsParciais, true);
}

/**
 * A tela, para a exportação (exportar-oxr.ts), que registra só a EXPORTACAO. Fora do index.ts: a porta pública sempre
 * registra a CONSULTA (RN_EO_006; revisão 12.12).
 */
export async function montarOrcadoRealizado(ctx: ContextoRequisicao, filtros: FiltrosOxr, depsParciais: Partial<DepsOrc>, registrarConsulta: boolean): Promise<ResultadoOxr> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE_OXR, 'consultar');
  const propostas = await propostasOficiais(ctx, deps);
  if (filtros.proposta === undefined) return resposta(propostas, null, null);
  const propostaId = filtros.proposta;
  if (!propostaId || !uuid.safeParse(propostaId).success) return resposta(propostas, null, MENSAGENS_OXR.SEM_TP);
  const arvore = await deps.estruturaCompleta.listarArvoreContas(deps.cliente, { incluirInativos: true });
  return emUnidade(
    ctx,
    async (tx) => {
      const p = await tx.propostaTp.findFirst({
        where: { id: propostaId, excluidaEm: null },
        include: { unidade: { select: { codigo: true } }, versoes: { where: { snapshot: { isNot: null } }, orderBy: { numero: 'desc' }, take: 1, select: { id: true, numero: true } } },
      });
      if (!p) return resposta(propostas, null, MENSAGENS_OXR.SEM_TP);
      const oficial = p.versoes[0];
      if (!oficial) return resposta(propostas, null, MENSAGENS_OXR.TP_NAO_OFICIAL);
      const vigencia = competenciasDaVigencia(p.inicio, p.fim);
      // Período padrão: os primeiros meses da vigência, até o limite (D-P33-3).
      const de = filtros.de && COMPETENCIA.test(filtros.de) ? filtros.de : vigencia[0]!;
      // Sem o final: até 24 meses a partir do inicial, dentro da vigência (revisão 12.12).
      const ate = filtros.ate && COMPETENCIA.test(filtros.ate) ? filtros.ate : (vigencia.filter((c) => c >= de).slice(0, MESES_MAXIMOS_OXR).at(-1) ?? de);
      if (de > ate) return resposta(propostas, null, MENSAGENS_OXR.PERIODO_INVALIDO);
      if (de < vigencia[0]! || ate > vigencia[vigencia.length - 1]!) return resposta(propostas, null, MENSAGENS_OXR.PERIODO_FORA);
      const meses = vigencia.filter((c) => c >= de && c <= ate);
      if (meses.length > MESES_MAXIMOS_OXR) return resposta(propostas, null, MENSAGENS_OXR.PERIODO_LONGO);
      const conta = (filtros.conta ?? '').trim().slice(0, 40);
      const zeradas = filtros.zeradas ?? false;

      if (registrarConsulta) await auditar(tx, {
        contexto: { ...contextoAuditoria(ctx), unidadeId: p.unidadeId },
        funcionalidade: FUNCIONALIDADE_OXR,
        tipo: 'CONSULTA',
        registroId: p.id,
        descricao: `Consulta ao Orçado x Realizado do TP ${p.unidade.codigo}`,
        depois: { de, ate, conta: conta || 'Todas', zeradas },
      });
      const comPessoal = vePessoal(ctx);
      const [s, r, acumulado] = await Promise.all([
        seriesDaVersao(tx, deps, oficial.id, comPessoal, vigencia),
        lerRealizado(tx, p.unidadeId, de, ate),
        // Seção 5.1: o realizado acumulado desde o início do TP até o fim do período, para o indicador global.
        lerRealizado(tx, p.unidadeId, vigencia[0]!, ate),
      ]);
      // D-P33-2 (revisão 12.12): sem ver o pessoal, as contas de pessoal saem dos dois lados. Comparar o orçado sem o
      // pessoal com o realizado com ele daria "Sem orçamento" falso e totais, % e saldo errados nas sintéticas.
      const ePessoal = (c: string) => !comPessoal && RAIZES_CONTAS_PESSOAL.some((raiz) => c === raiz || c.startsWith(`${raiz}.`));
      const semAsDePessoal = <T,>(pares: Iterable<[string, T]>) => new Map([...pares].filter(([k]) => !ePessoal(k.split('|')[0]!)));
      const realizado = semAsDePessoal(r.linhas.map((l): [string, Dinheiro] => [`${l.conta}|${l.competencia}`, l.valor]));
      const porConta = (pares: Iterable<[string, Dinheiro]>) => {
        const m = new Map<string, Dinheiro>();
        for (const [k, v] of pares) {
          const c = k.split('|')[0]!;
          m.set(c, (m.get(c) ?? Dinheiro.zero()).somar(v));
        }
        return m;
      };
      const global = {
        orcado: porConta(semAsDePessoal(s.porContaMes)),
        realizado: porConta(semAsDePessoal(acumulado.linhas.map((l): [string, Dinheiro] => [`${l.conta}|${l.competencia}`, l.valor]))),
      };
      const grade = montarGradeOxr(arvore as readonly NoPlanoOxr[], meses, semAsDePessoal(s.porContaMes), realizado, { zeradas, conta: conta || undefined }, global);
      return resposta(
        propostas,
        {
          propostaId: p.id,
          unidadeId: p.unidadeId,
          numero: p.unidade.codigo,
          objeto: p.objeto,
          versaoOficial: oficial.numero,
          vigencia: { inicio: competenciaParaTexto(p.inicio), fim: competenciaParaTexto(p.fim) },
          filtros: { de, ate, conta, zeradas },
          meses,
          grade,
          pendencias: r.pendencias,
          atualizadoEm: r.atualizadoEm,
          semPessoal: !comPessoal,
          pessoalNaoHomologado: s.pessoalNaoHomologado,
        },
        null,
      );
    },
    { cliente: deps.cliente },
  );
}
