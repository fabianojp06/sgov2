import { z } from 'zod';
import type { ContextoRequisicao } from '@/shared/authz';
import { ErroIA } from '@/shared/ia';
import { Dinheiro, falha, ok, Percentual, type Resultado } from '@/shared/kernel';
import { semMarcas } from '../domain/texto';
import { valorParaTela } from '../domain/valor-tela';
import { mesOxr, type LinhaOxr } from './grade-oxr';
import { CASOS_IA_ORC } from './ia-casos';
import { mensagemErroIA, resolverDepsIa, type DepsIaOrc } from './ia-deps';
import { montarOrcadoRealizado, type TelaOxr } from './orcado-realizado';

// Explicação do desvio orçado x realizado (US-090; IA-09 da spec §6.8; plano do P35). Só leitura. O sistema monta os
// fatos (o total do período, as contas com maior desvio, as que compensaram, os meses que mais pesaram, os ajustes de
// meses fechados e as pendências) a partir da tela do Orçado x Realizado, com a mesma permissão, RLS e regra do
// pessoal; a IA só redige. "Números das ferramentas, não da IA" (critério da #112): todo número e todo mês do texto
// precisam estar entre os que o sistema formatou; senão, a resposta é recusada [D-P35-2]. As contas e os meses citados que não
// estão nos fatos são descartados.
//
// Minimização (spec §4.4): o número do TP, o período e os números; nunca o objeto do TP nem nomes de pessoas.

const CASO = CASOS_IA_ORC.desvio;
const PERMISSAO_IA = `${CASO.funcionalidade}:executar`;
const MAXIMO_CONTAS = 8;
const MAXIMO_MESES = 3;

export type ExplicacaoDesvio = { texto: string; contas: readonly string[]; meses: readonly string[] };

const ENTRADA = z
  .object({ proposta: z.string(), de: z.string().optional(), ate: z.string().optional(), conta: z.string().optional(), zeradas: z.boolean().optional() })
  .strict();
export const RESPOSTA_DESVIO = z.object({
  texto: z.string().trim().min(30).max(1500),
  contas: z.array(z.string().trim().min(1).max(40)).max(10),
  meses: z.array(z.string().trim().min(1).max(10)).max(12),
});

const erro = (mensagem: string): Resultado<never> => falha([{ campo: '_', mensagem }]);
export const SEM_DESVIO = 'O realizado do período está igual ao orçado: não há desvio a explicar.';
export const NUMERO_INVENTADO = 'A explicação da IA trouxe um número que não veio do sistema e foi descartada. Peça de novo.';

const MAXIMO_AJUSTES = 10;
const MES = /[A-Z][a-z]{2}\/\d{2}/g;
const NUMERO = /\d+(?:[.,]\d+)*/g;

/**
 * Os fatos e os tokens que o sistema formatou (D-P35-2; revisão 12.12): só os valores, percentuais, meses, contas e o
 * número do TP montados aqui valem como "números das ferramentas". A descrição das contas (cadastro) e o filtro digitado
 * entram no texto, mas nunca na lista do que é aceito.
 */
class Fatos {
  readonly numeros = new Set<string>();
  readonly meses = new Set<string>();
  readonly contas = new Set<string>();
  /** Registra um texto formatado pelo sistema e o devolve, para montar a linha. */
  n(texto: string): string {
    for (const t of texto.match(NUMERO) ?? []) this.numeros.add(t);
    return texto;
  }
  mes(c: string): string {
    const m = mesOxr(c);
    this.meses.add(m);
    return m;
  }
  conta(c: string): string {
    this.contas.add(c);
    return this.n(c);
  }
  valor(v: Dinheiro): string {
    return this.n(valorParaTela(v));
  }
  uso(orcado: Dinheiro, realizado: Dinheiro): string {
    const p = Percentual.razao(realizado, orcado);
    return p ? this.n(p.formatar()) : 'sem orçamento';
  }
}

const desvioDe = (l: LinhaOxr) => l.periodo.realizado.subtrair(l.periodo.orcado);
const limpo = (t: string) => semMarcas(t).replace(/\s+/g, ' ').trim();
const naConta = (conta: string, filtro: string) => !filtro || conta === filtro || conta.startsWith(`${filtro}.`);

/** Os fatos da mensagem, só das analíticas: as que mais estouraram, as que compensaram e os meses que mais pesaram. */
export function montarMensagemDesvio(t: TelaOxr): { mensagem: string; fatos: Fatos } {
  const f = new Fatos();
  const linhaConta = (l: LinhaOxr) =>
    `- ${f.conta(l.conta)} (${limpo(l.descricao)}): orçado R$ ${f.valor(l.periodo.orcado)}; realizado R$ ${f.valor(l.periodo.realizado)}; desvio R$ ${f.valor(desvioDe(l))}; uso ${f.uso(l.periodo.orcado, l.periodo.realizado)}.`;
  const analiticas = t.grade.linhas.filter((l) => l.analitica && !desvioDe(l).ehZero());
  const acima = analiticas.filter((l) => !desvioDe(l).ehNegativo()).sort((a, b) => desvioDe(b).comparar(desvioDe(a))).slice(0, MAXIMO_CONTAS);
  const abaixo = analiticas.filter((l) => desvioDe(l).ehNegativo()).sort((a, b) => desvioDe(a).comparar(desvioDe(b))).slice(0, MAXIMO_CONTAS);
  const porMes = t.meses
    .map((m, i) => ({ mes: m, c: t.grade.total.meses[i]! }))
    .map((x) => ({ ...x, desvio: x.c.realizado.subtrair(x.c.orcado) }))
    .filter((x) => !x.desvio.ehZero())
    .sort((a, b) => b.desvio.paraDecimal().abs().comparedTo(a.desvio.paraDecimal().abs()))
    .slice(0, MAXIMO_MESES);
  // Os ajustes só da conta do filtro (a subárvore, como a grade), com teto (revisão 12.12).
  const ajustes = t.ajustes.filter((a) => naConta(a.conta, t.filtros.conta)).slice(0, MAXIMO_AJUSTES);
  const p = t.grade.total.periodo;
  const linhas = [
    `Termo de Parceria ${f.n(t.numero)}, de ${f.mes(t.filtros.de)} a ${f.mes(t.filtros.ate)}${t.filtros.conta ? `, conta ${limpo(t.filtros.conta)}` : ''}.`,
    `Total do período: orçado R$ ${f.valor(p.orcado)}; realizado R$ ${f.valor(p.realizado)}; saldo R$ ${f.valor(p.saldo)}; uso ${f.uso(p.orcado, p.realizado)}.`,
    ...(t.semPessoal || t.pessoalNaoHomologado ? ['As contas de pessoal não estão nos números.'] : []),
    'Contas com realizado acima do orçado:',
    ...(acima.length > 0 ? acima.map(linhaConta) : ['- nenhuma.']),
    'Contas com realizado abaixo do orçado (compensaram):',
    ...(abaixo.length > 0 ? abaixo.map(linhaConta) : ['- nenhuma.']),
    'Meses que mais pesaram no desvio:',
    ...(porMes.length > 0
      ? porMes.map((x) => `- ${f.mes(x.mes)}: orçado R$ ${f.valor(x.c.orcado)}; realizado R$ ${f.valor(x.c.realizado)}; desvio R$ ${f.valor(x.desvio)}.`)
      : ['- nenhum.']),
    'Ajustes de meses fechados lançados no período:',
    ...(ajustes.length > 0 ? ajustes.map((a) => `- ${f.conta(a.conta)}: R$ ${f.valor(a.valor)}, de ${f.mes(a.origem)} lançado em ${f.mes(a.lancamento)}.`) : ['- nenhum.']),
    t.pendencias.quantidade > 0
      ? `Pendências do ERP sem conta no SGO: ${f.n(String(t.pendencias.quantidade))}, R$ ${f.valor(t.pendencias.valor)}, fora dos números.`
      : 'Sem pendências do ERP.',
  ];
  // O valor sem o sinal também vale ("R$ 350,00 abaixo" para o desvio de -350,00).
  for (const n of [...f.numeros]) f.numeros.add(n.replace(/^-/, ''));
  return { mensagem: linhas.join('\n'), fatos: f };
}

/**
 * D-P35-2 (revisão 12.12): cada mês (Mmm/AA) do texto precisa estar entre os meses dos fatos, e cada número, inteiro,
 * entre os números que o sistema formatou. Devolve o que não está.
 */
export function numerosForaDosFatos(texto: string, fatos: { numeros: ReadonlySet<string>; meses: ReadonlySet<string> }): string[] {
  const meses = texto.match(MES) ?? [];
  const resto = texto.replace(MES, ' ');
  return [...new Set([...meses.filter((m) => !fatos.meses.has(m)), ...(resto.match(NUMERO) ?? []).filter((n) => !fatos.numeros.has(n))])];
}

export async function explicarDesvio(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsIaOrc> = {}): Promise<Resultado<ExplicacaoDesvio>> {
  if (!ctx.permissoes.has(PERMISSAO_IA)) return erro(new ErroIA('ia.sem_permissao').message);
  const deps = resolverDepsIa(depsParciais);
  const parse = ENTRADA.safeParse(bruto);
  if (!parse.success) return erro('Dados da consulta inválidos. Recarregue a tela.');
  // A tela com a permissão (orc.oxr:consultar), a RLS e a regra do pessoal de quem pede, sem outra CONSULTA.
  const r = await montarOrcadoRealizado(ctx, parse.data, deps, false);
  if (!r.tela) return erro(r.erro ?? 'Selecione um Termo de Parceria para consultar.');
  const { mensagem, fatos } = montarMensagemDesvio(r.tela);
  if (fatos.contas.size === 0) return ok({ texto: SEM_DESVIO, contas: [], meses: [] });
  const sinal = deps.sinalIa();
  try {
    const { valor } = await deps.ia.gerarEstruturado(ctx, CASO, mensagem, RESPOSTA_DESVIO, sinal);
    if (numerosForaDosFatos(valor.texto, fatos).length > 0) return erro(NUMERO_INVENTADO);
    return ok({
      texto: valor.texto,
      contas: [...new Set(valor.contas.map((c) => c.trim()))].filter((c) => fatos.contas.has(c)),
      meses: [...new Set(valor.meses.map((m) => m.trim()))].filter((m) => fatos.meses.has(m)),
    });
  } catch (x) {
    if (!(x instanceof ErroIA)) throw x;
    return erro(mensagemErroIA(x, sinal));
  }
}
