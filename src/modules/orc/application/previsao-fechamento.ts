import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { Dinheiro } from '@/shared/kernel';
import { emUnidade } from '@/shared/unidade';
import { competenciaParaTexto } from '../domain/empregado';
import { RAIZES_CONTAS_PESSOAL } from '../domain/planilha';
import { preverConta, type PrevisaoConta } from '../domain/previsao';
import { competenciasDaVigencia } from '../domain/rateio';
import { contextoAuditoria } from './calculo-linhas';
import { seriesDaVersao } from './cronograma';
import { resolverDeps, type DepsOrc } from './deps';
import { FUNCIONALIDADE_OXR, MENSAGENS_OXR, propostasOficiais, type PropostaOxr } from './orcado-realizado';
import { uuid } from './pessoal-comum';
import { lerRealizado } from './realizado';
import { vePessoal } from './totalizadores';

// Previsão de fechamento do ano do TP (US-091; IA-10; plano do P34). Só leitura, com a permissão do Orçado x Realizado
// (orc.oxr:consultar). O orçado é o cronograma da última versão oficializada (D-P33-1) e o realizado é o carregado
// (US-085), com a mesma regra do pessoal (D-P33-2). O motor é o domain/previsao.ts; o mês de corte é o último mês do
// ano com realizado carregado [PROVISÓRIO, D-P34-2]. A consulta vai ao Histórico.

export type ContaPrevista = PrevisaoConta & { descricao: string };
export type TelaPrevisao = {
  propostaId: string;
  unidadeId: string;
  numero: string;
  objeto: string;
  versaoOficial: number;
  ano: number;
  anos: readonly number[];
  /** O último mês do ano com realizado ('AAAA-MM'); nulo se não há realizado no ano (a projeção é só o orçado). */
  mesCorte: string | null;
  /** As contas analíticas com orçado ou realizado no ano; as em risco primeiro, pelo maior desvio. */
  contas: readonly ContaPrevista[];
  total: PrevisaoConta;
  semPessoal: boolean;
  /** Há empregados na versão oficial sem o lote homologado: o pessoal fica fora dos dois lados (revisão 12.12). */
  pessoalNaoHomologado: boolean;
  /** As pendências do realizado no ano (RN_OXR_004): o projetado não as conta. */
  pendencias: { quantidade: number; valor: Dinheiro };
};
export type ResultadoPrevisao = { propostas: readonly PropostaOxr[]; tela: TelaPrevisao | null; erro: string | null };

export const MENSAGEM_ANO_FORA = 'Escolha um ano dentro da vigência do Termo de Parceria.';

const anoBrasilia = (d: Date) => Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric' }).format(d));

export type FiltrosPrevisao = { proposta?: string | undefined; ano?: string | undefined };

export async function obterPrevisaoFechamento(ctx: ContextoRequisicao, filtros: FiltrosPrevisao, depsParciais: Partial<DepsOrc> = {}): Promise<ResultadoPrevisao> {
  return montarPrevisao(ctx, filtros, depsParciais, true);
}

/** A previsão para o destaque da IA (ia-previsao.ts), sem uma segunda CONSULTA no Histórico. Fora do index.ts. */
export async function montarPrevisao(ctx: ContextoRequisicao, filtros: FiltrosPrevisao, depsParciais: Partial<DepsOrc>, registrarConsulta: boolean): Promise<ResultadoPrevisao> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE_OXR, 'consultar');
  const propostas = await propostasOficiais(ctx, deps);
  const resposta = (tela: TelaPrevisao | null, erro: string | null): ResultadoPrevisao => ({ propostas, tela, erro });
  if (filtros.proposta === undefined) return resposta(null, null);
  const propostaId = filtros.proposta;
  if (!propostaId || !uuid.safeParse(propostaId).success) return resposta(null, MENSAGENS_OXR.SEM_TP);
  const arvore = await deps.estruturaCompleta.listarArvoreContas(deps.cliente, { incluirInativos: true });
  const descricoes = new Map<string, string>();
  const visitar = (nos: typeof arvore) => nos.forEach((n) => (descricoes.set(n.classificacao, n.descricao), visitar(n.filhos)));
  visitar(arvore);
  return emUnidade(
    ctx,
    async (tx) => {
      const p = await tx.propostaTp.findFirst({
        where: { id: propostaId, excluidaEm: null },
        include: { unidade: { select: { codigo: true } }, versoes: { where: { snapshot: { isNot: null } }, orderBy: { numero: 'desc' }, take: 1, select: { id: true, numero: true } } },
      });
      if (!p) return resposta(null, MENSAGENS_OXR.SEM_TP);
      const oficial = p.versoes[0];
      if (!oficial) return resposta(null, MENSAGENS_OXR.TP_NAO_OFICIAL);
      const vigencia = competenciasDaVigencia(p.inicio, p.fim);
      const anos = [...new Set(vigencia.map((c) => Number(c.slice(0, 4))))];
      const padrao = Math.min(Math.max(anoBrasilia(deps.agora()), anos[0]!), anos[anos.length - 1]!);
      const ano = filtros.ano && /^\d{4}$/.test(filtros.ano) ? Number(filtros.ano) : padrao;
      if (!anos.includes(ano)) return resposta(null, MENSAGEM_ANO_FORA);
      const meses = Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, '0')}`);

      if (registrarConsulta) await auditar(tx, {
        contexto: { ...contextoAuditoria(ctx), unidadeId: p.unidadeId },
        funcionalidade: FUNCIONALIDADE_OXR,
        tipo: 'CONSULTA',
        registroId: p.id,
        descricao: `Consulta à previsão de fechamento de ${ano} do TP ${p.unidade.codigo}`,
        depois: { ano },
      });
      const comPessoal = vePessoal(ctx);
      const naVigencia = new Set(vigencia);
      const [s, r, ultimaCarga] = await Promise.all([
        seriesDaVersao(tx, deps, oficial.id, comPessoal, vigencia),
        lerRealizado(tx, p.unidadeId, meses[0], meses[11]),
        // D-P34-2 (revisão 12.12): o corte vem das cargas, não dos ajustes. Um ajuste de mês fechado lançado depois da
        // última carga não pode empurrar o corte e zerar o mês para as outras contas.
        tx.realizadoContaMes.findFirst({
          where: { unidadeId: p.unidadeId, competencia: { gte: new Date(`${meses[0]}-01T00:00:00Z`), lte: new Date(`${meses[11]}-01T00:00:00Z`) } },
          orderBy: { competencia: 'desc' },
          select: { competencia: true },
        }),
      ]);
      // Sem ver o pessoal (D-P23-5) ou com o lote ainda não homologado (o orçado não o tem), as contas de pessoal saem dos
      // dois lados: senão viram estouro falso e vão à IA (revisão 12.12).
      const semPessoal = !comPessoal || s.pessoalNaoHomologado;
      const ePessoal = (c: string) => semPessoal && RAIZES_CONTAS_PESSOAL.some((raiz) => c === raiz || c.startsWith(`${raiz}.`));
      const series = new Map<string, { orcado: Dinheiro[]; realizado: Dinheiro[] }>();
      const serie = (conta: string) => {
        const atual = series.get(conta) ?? { orcado: meses.map(() => Dinheiro.zero()), realizado: meses.map(() => Dinheiro.zero()) };
        series.set(conta, atual);
        return atual;
      };
      for (const [k, v] of s.porContaMes) {
        const [conta, mes] = k.split('|') as [string, string];
        const i = meses.indexOf(mes);
        if (i >= 0 && !ePessoal(conta)) serie(conta).orcado[i] = serie(conta).orcado[i]!.somar(v);
      }
      // Só os meses da vigência, como no Orçado x Realizado (um ajuste lançado depois do fim do TP fica de fora).
      for (const l of r.linhas) {
        const i = meses.indexOf(l.competencia);
        if (i < 0 || !naVigencia.has(l.competencia) || ePessoal(l.conta)) continue;
        serie(l.conta).realizado[i] = serie(l.conta).realizado[i]!.somar(l.valor);
      }
      const mesCarga = ultimaCarga ? competenciaParaTexto(ultimaCarga.competencia) : null;
      // A carga depois do fim da vigência não estende o corte: vale o último mês vigente até ela.
      const ultimoMes = mesCarga ? meses.filter((c) => c <= mesCarga && naVigencia.has(c)).at(-1) : undefined;
      const corte = ultimoMes ? meses.indexOf(ultimoMes) : -1;
      const contas = [...series.entries()]
        .map(([conta, x]) => ({ ...preverConta(meses, corte, { conta, ...x }), descricao: descricoes.get(conta) ?? 'Conta fora do plano' }))
        .sort((a, b) => Number(b.risco) - Number(a.risco) || b.desvio.comparar(a.desvio) || a.conta.localeCompare(b.conta, 'pt-BR', { numeric: true }));
      const soma = (k: 'orcado' | 'realizado') => meses.map((_, i) => Dinheiro.somarTodos([...series.values()].map((x) => x[k][i]!)));
      return resposta(
        {
          propostaId: p.id,
          unidadeId: p.unidadeId,
          numero: p.unidade.codigo,
          objeto: p.objeto,
          versaoOficial: oficial.numero,
          ano,
          anos,
          mesCorte: corte >= 0 ? meses[corte]! : null,
          contas,
          total: preverConta(meses, corte, { conta: 'Total', orcado: soma('orcado'), realizado: soma('realizado') }),
          semPessoal: !comPessoal,
          pessoalNaoHomologado: comPessoal && s.pessoalNaoHomologado,
          pendencias: r.pendencias,
        },
        null,
      );
    },
    { cliente: deps.cliente },
  );
}

