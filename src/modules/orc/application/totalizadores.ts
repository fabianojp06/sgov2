import { exigir, type ContextoRequisicao } from '@/shared/authz';
import type { TxCliente } from '@/shared/db';
import { Dinheiro } from '@/shared/kernel';
import { totalizar } from '@/shared/totalizer';
import { emUnidade } from '@/shared/unidade';
import { totalDoBem } from '../domain/bem';
import { ROTULO_TIPO_PROPOSTA, type SituacaoProposta, type TipoProposta } from '../domain/proposta';
import { montarArvore, separarPorPlano, type NoTotal } from '../domain/totalizador';
import { custoDaViagem } from '../domain/viagem';
import { cacheAnos, custoDoEmpregado } from './custo-empregado';
import { carregarCargos } from './custo-posicao';
import { resolverDeps, type DepsOrc } from './deps';

// Totalizadores da proposta de TP (US-074; UC03.02; plano do P23, Task 1). Sem tabela: o Totalizador é o
// cálculo na leitura (REQ_TOT_002) das somas por conta analítica dos lançamentos da versão (RN_TOT_03), e as
// sintéticas vêm do motor único de totais (RN_TOT_02, @/shared/totalizer). O mesmo cálculo dá o Valor Global da
// capa (RN_TP_003, D-P23-6). O pessoal só entra para quem vê o custo dele (D-P20-5, D-P23-5).

const FUNCIONALIDADE = 'orc.totalizadores';

/** D-P20-5 e D-P23-5: quem lança os empregados vê o custo do pessoal (e o total com ele). */
export const vePessoal = (ctx: ContextoRequisicao) => ctx.permissoes.has('orc.empregados:incluir') || ctx.permissoes.has('orc.empregados:alterar');

const somar = (porConta: Map<string, Dinheiro>, conta: string, valor: Dinheiro) => {
  if (!valor.ehZero()) porConta.set(conta, (porConta.get(conta) ?? Dinheiro.zero()).somar(valor));
};

export type TotaisDaVersao = {
  porConta: ReadonlyMap<string, Dinheiro>;
  total: Dinheiro;
  /** Anos sem parâmetros e recusas do motor no pessoal. */
  avisos: readonly string[];
  /** A versão tem pessoal, mas quem pede não vê o custo dele: o total vem sem o pessoal. */
  semPessoal: boolean;
};

/**
 * RN_TOT_03: as somas por conta analítica dos lançamentos da versão, na transação de quem chama (com a RLS).
 * Pessoal pelas linhas do motor ano a ano; viagens com passagem, diária e transporte cada um na sua conta (o
 * transporte é despesa da conta, mesmo fora do custo estimado, C19); bens ativos.
 */
export async function totaisDaVersao(tx: TxCliente, deps: DepsOrc, versaoId: string, comPessoal: boolean): Promise<TotaisDaVersao> {
  const porConta = new Map<string, Dinheiro>();
  const avisos = new Set<string>();
  const [empregados, viagens, bens] = await Promise.all([
    tx.empregadoProposta.findMany({ where: { versaoPropostaId: versaoId } }),
    tx.viagemProposta.findMany({ where: { versaoPropostaId: versaoId } }),
    tx.bemProposta.findMany({ where: { versaoPropostaId: versaoId, ativo: true } }),
  ]);
  if (comPessoal && empregados.length > 0) {
    const anos = cacheAnos(await carregarCargos(tx, deps));
    for (const e of empregados) {
      const c = await custoDoEmpregado(tx, deps, anos, { ...e, salarioMensal: Dinheiro.de(e.salarioMensal.toString()) }, porConta);
      for (const a of [...c.avisos, ...c.erros]) avisos.add(a);
    }
  }
  for (const v of viagens) {
    const c = custoDaViagem({
      pessoas: v.pessoas,
      dias: v.dias,
      valorPassagem: Dinheiro.de(v.valorPassagem.toString()),
      valorDiaria: Dinheiro.de(v.valorDiaria.toString()),
      valorTransporte: Dinheiro.de(v.valorTransporte.toString()),
    });
    somar(porConta, v.contaPassagem, c.passagem);
    somar(porConta, v.contaDiaria, c.diaria);
    if (v.contaTransporte) somar(porConta, v.contaTransporte, c.transporte);
  }
  for (const b of bens) somar(porConta, b.conta, totalDoBem({ quantidade: b.quantidade, valorUnitario: Dinheiro.de(b.valorUnitario.toString()) }));
  return { porConta, total: Dinheiro.somarTodos([...porConta.values()]), avisos: [...avisos], semPessoal: !comPessoal && empregados.length > 0 };
}

/** O Valor Global da última versão de cada proposta (RN_TP_003, D-P23-6), na transação de quem chama. */
export async function valoresGlobais(tx: TxCliente, deps: DepsOrc, versoes: ReadonlyMap<string, string>, comPessoal: boolean): Promise<Map<string, Dinheiro>> {
  const r = new Map<string, Dinheiro>();
  for (const [propostaId, versaoId] of versoes) r.set(propostaId, (await totaisDaVersao(tx, deps, versaoId, comPessoal)).total);
  return r;
}

export type TotalizadoresTela = {
  propostaId: string;
  numero: string;
  objeto: string;
  tipo: TipoProposta;
  versaoNumero: number;
  situacao: SituacaoProposta;
  arvore: readonly NoTotal[];
  foraDoPlano: readonly { conta: string; valor: Dinheiro }[];
  total: Dinheiro;
  avisos: readonly string[];
  semPessoal: boolean;
};

export type PropostaParaTotalizar = { id: string; numero: string; objeto: string; tipo: string };

/** Sem proposta escolhida: as propostas do usuário (RLS), para escolher (D-P23-4). */
export async function propostasParaTotalizar(ctx: ContextoRequisicao, depsParciais: Partial<DepsOrc> = {}): Promise<readonly PropostaParaTotalizar[]> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const ps = await emUnidade(ctx, (tx) => tx.propostaTp.findMany({ where: { excluidaEm: null }, include: { unidade: { select: { codigo: true } } } }), { cliente: deps.cliente });
  return ps
    .map((p) => ({ id: p.id, numero: p.unidade.codigo, objeto: p.objeto, tipo: ROTULO_TIPO_PROPOSTA[p.tipo as TipoProposta] }))
    .sort((a, b) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));
}

/** UC03.02: a árvore de totais da última versão da proposta, só leitura (RN_TOT_01). Nula se o usuário não a vê. */
export async function obterTotalizadores(ctx: ContextoRequisicao, propostaId: string, depsParciais: Partial<DepsOrc> = {}): Promise<TotalizadoresTela | null> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  if (!/^[0-9a-f-]{36}$/i.test(propostaId)) return null;
  const [arvoreContas, indice] = await Promise.all([deps.estruturaCompleta.listarArvoreContas(deps.cliente), deps.estruturaCompleta.carregarIndiceEstrutura(deps.cliente)]);
  return emUnidade(
    ctx,
    async (tx) => {
      const p = await tx.propostaTp.findFirst({
        where: { id: propostaId, excluidaEm: null },
        include: { unidade: { select: { codigo: true } }, versoes: { orderBy: { numero: 'desc' }, take: 1, select: { id: true, numero: true, situacao: true } } },
      });
      const v = p?.versoes[0];
      if (!p || !v) return null;
      const t = await totaisDaVersao(tx, deps, v.id, vePessoal(ctx));
      const { dentro, fora } = separarPorPlano(t.porConta, (c) => indice.contaAnaliticaAtiva(c));
      const r = totalizar(indice.nosContas, dentro);
      return {
        propostaId: p.id,
        numero: p.unidade.codigo,
        objeto: p.objeto,
        tipo: p.tipo as TipoProposta,
        versaoNumero: v.numero,
        situacao: v.situacao as SituacaoProposta,
        arvore: montarArvore(arvoreContas, (c) => r.valor(c)),
        foraDoPlano: fora,
        total: t.total,
        avisos: t.avisos,
        semPessoal: t.semPessoal,
      };
    },
    { cliente: deps.cliente },
  );
}
