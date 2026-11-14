import 'server-only';
import { z } from 'zod';
import { obterConsolidado, obterVisaoExercicio, type VisaoExercicio } from '@/modules/orc';
import type { ContextoRequisicao } from '@/shared/authz';
import { ErroIA, servicoIA, type ServicoIA } from '@/shared/ia';
import { Dinheiro, ErroDominio, falha, ok, type Resultado } from '@/shared/kernel';
import { conferirClassificacao, mensagemPergunta, mesmoCc, mesmoTp, validarPergunta, type Classificacao, type Resposta } from '../domain/pergunte-sgo';
import { mesEmBrasilia } from '../domain/relatorio-executivo';
import { FUNCIONALIDADE_DESPESAS, obterDespesasTp, PORTA_REALIZADO, type TelaDespesas } from './despesas-tp';
import { mesPorExtenso } from './despesas-tp-montagem';
import { CASO_PERGUNTE_SGO } from './ia-casos';
import { FUNCIONALIDADE_RECEITAS_DESPESAS, obterReceitasDespesasTp, type TelaReceitasDespesas } from './receitas-despesas';

// Pergunte ao SGO (US-104, IA-16), parte 1. A IA só classifica a pergunta numa consulta do catálogo (com o
// ano, o CC ou o TP); o SISTEMA executa a consulta pelas portas públicas do orc, as MESMAS das telas do link
// (orçamento: obterVisaoExercicio; TPs: obterConsolidado), com o ctx de quem pergunta (as mesmas permissões,
// o escopo do Gestor e a RLS), e monta a resposta com o número, a fonte e o link. Nada é gravado além da
// chamada (ia_chamada) e do que as portas já registram (a CONSULTA do consolidado). Parte 2: o realizado e o
// saldo de um TP pelos casos de uso dos demonstrativos (US-096), os mesmos das telas do link.

export const TEMPO_LIMITE_PERGUNTA_MS = 30_000;
const PERMISSAO_IA = `${CASO_PERGUNTE_SGO.funcionalidade}:executar`;
const PERMISSAO_ORCAMENTO = 'orc.orcamento:consultar';
const PERMISSAO_CONSOLIDADO = 'orc.consolidado:consultar';
const PERMISSAO_REALIZADO = 'orc.realizado:consultar';
const PERMISSAO_DESPESAS = `${FUNCIONALIDADE_DESPESAS}:consultar`;
const PERMISSAO_RECEITAS_DESPESAS = `${FUNCIONALIDADE_RECEITAS_DESPESAS}:consultar`;
/** Consulta o realizado de TP: a permissão do orc e a do demonstrativo do link. */
const veRealizado = (ctx: ContextoRequisicao, relatorio: string) => ctx.permissoes.has(PERMISSAO_REALIZADO) && ctx.permissoes.has(relatorio);

export const MENSAGENS_PERGUNTE = {
  NAO_SEI:
    'Ainda não sei responder a essa pergunta. Por enquanto, respondo sobre o orçamento, o pessoal, o teto, o saldo e o resultado da Administração Central, o orçado de um centro de custo, o Valor Global dos Termos de Parceria e o realizado e o saldo acumulado (previsto menos realizado) de um TP.',
  SEM_ACESSO: 'O seu perfil não consulta o orçamento da Administração Central, o Consolidado dos TPs nem o realizado dos TPs.',
  SEM_ACESSO_REALIZADO: 'O seu perfil não consulta o realizado dos TPs (Orçamento › Realizado e o demonstrativo em Relatórios).',
  SEM_ACESSO_RELATORIO: (nome: string) => `O seu perfil não consulta o ${nome}, de onde vem esse número.`,
  TP_SEM_REALIZADO: (tp: string) => `O TP ${tp} não está entre os TPs oficializados que você consulta.`,
  ANO_FORA_DA_VIGENCIA: (tp: string, ano: number) => `O ano ${ano} está fora da vigência do TP ${tp}.`,
  SEM_PREVISTO: (tp: string) => `O TP ${tp} não tem versão oficializada com previsto, então não há saldo.`,
  SEM_ACESSO_ORCAMENTO: 'O seu perfil não consulta o orçamento da Administração Central.',
  SEM_ACESSO_CONSOLIDADO: 'O seu perfil não consulta o Consolidado dos TPs.',
  SEM_EXERCICIO: (ano: number) => `Não há exercício ${ano} no orçamento da Administração Central.`,
  SEM_NENHUM_EXERCICIO: 'Ainda não há exercício no orçamento da Administração Central.',
  SO_INTEIRA: 'Esse número só aparece para quem vê a Administração Central inteira.',
  CC_FORA: (cc: string) => `O centro de custo ${cc} não está no orçamento que você acessa (use a classificação, como 4.3.2).`,
  TP_FORA: (tp: string) => `O TP ${tp} não está no consolidado.`,
  TP_NAO_OFICIAL: (tp: string) => `O TP ${tp} ainda não tem versão oficializada, então não tem Valor Global oficial.`,
  TEMPO_ESGOTADO: 'A IA demorou demais para responder. Tente de novo.',
} as const;

const SAIDA = z.object({
  consulta: z.string().max(40),
  ano: z.number().int().nullable(),
  cc: z.string().max(40).nullable(),
  tp: z.string().max(60).nullable(),
});

type LerVisao = (ctx: ContextoRequisicao, ano: number | null) => Promise<VisaoExercicio | null>;
type LerConsolidado = (ctx: ContextoRequisicao) => Promise<readonly { numero: string; orcado: Dinheiro | null; versaoOficial: number | null }[]>;
type FiltroTp = { tp?: string; de?: string; ate?: string };
type LerDespesas = (ctx: ContextoRequisicao, filtro: FiltroTp) => Promise<TelaDespesas>;
type LerReceitasDespesas = (ctx: ContextoRequisicao, filtro: FiltroTp) => Promise<TelaReceitasDespesas>;
export type DepsPergunte = {
  ia: ServicoIA;
  sinalIa: () => AbortSignal;
  agora: () => Date;
  lerVisao: LerVisao;
  lerConsolidado: LerConsolidado;
  lerDespesas: LerDespesas;
  lerReceitasDespesas: LerReceitasDespesas;
};

const LER_VISAO: LerVisao = (ctx, ano) => obterVisaoExercicio(ctx, ano, null);
const LER_CONSOLIDADO: LerConsolidado = async (ctx) => (await obterConsolidado(ctx)).linhas;
const LER_DESPESAS: LerDespesas = (ctx, f) => obterDespesasTp(ctx, f, PORTA_REALIZADO);
const LER_RECEITAS_DESPESAS: LerReceitasDespesas = (ctx, f) => obterReceitasDespesasTp(ctx, f, PORTA_REALIZADO);
const resolver = (d: Partial<DepsPergunte>): DepsPergunte => ({
  ia: d.ia ?? servicoIA,
  sinalIa: d.sinalIa ?? (() => AbortSignal.timeout(TEMPO_LIMITE_PERGUNTA_MS)),
  agora: d.agora ?? (() => new Date()),
  lerVisao: d.lerVisao ?? LER_VISAO,
  lerConsolidado: d.lerConsolidado ?? LER_CONSOLIDADO,
  lerDespesas: d.lerDespesas ?? LER_DESPESAS,
  lerReceitasDespesas: d.lerReceitasDespesas ?? LER_RECEITAS_DESPESAS,
});

const erro = (mensagem: string, campo = '_'): Resultado<never> => falha([{ campo, mensagem }]);
const tempoEsgotado = (sinal: AbortSignal) => sinal.aborted && (sinal.reason as { name?: unknown } | undefined)?.name === 'TimeoutError';
const semDado = (texto: string, fonte: string | null = null, link: string | null = null): Resposta => ({ tipo: 'SEM_DADO', texto, fonte, link });

type NoArvore = { cc: string; descricao: string; total: Dinheiro; filhos: readonly NoArvore[] };
export function acharCc(nos: readonly NoArvore[], cc: string): NoArvore | null {
  for (const n of nos) {
    if (mesmoCc(n.cc, cc)) return n;
    const f = acharCc(n.filhos, cc);
    if (f) return f;
  }
  return null;
}

const dataBrasilia = (d: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);

/** O período do TP para a pergunta: o ano dito (cortado na vigência) ou a vigência inteira (RN0294). */
export function periodoDoTp(tp: { inicio: string; fim: string }, ano: number | null): { de: string; ate: string } | null {
  if (ano === null) return { de: tp.inicio, ate: tp.fim };
  const de = `${ano}-01` > tp.inicio ? `${ano}-01` : tp.inicio;
  const ate = `${ano}-12` < tp.fim ? `${ano}-12` : tp.fim;
  return de <= ate ? { de, ate } : null;
}

/** O realizado ou o saldo de um TP, pelo caso de uso do demonstrativo do link (o mesmo número da tela). */
async function consultaDoTp(ctx: ContextoRequisicao, c: Classificacao, deps: Pick<DepsPergunte, 'lerDespesas' | 'lerReceitasDespesas'>): Promise<Resposta> {
  const realizado = c.consulta === 'REALIZADO_TP';
  if (!ctx.permissoes.has(PERMISSAO_REALIZADO)) return semDado(MENSAGENS_PERGUNTE.SEM_ACESSO_REALIZADO);
  if (!veRealizado(ctx, realizado ? PERMISSAO_DESPESAS : PERMISSAO_RECEITAS_DESPESAS)) {
    return semDado(MENSAGENS_PERGUNTE.SEM_ACESSO_RELATORIO(realizado ? 'Demonstrativo de despesas do TP' : 'Demonstrativo de receitas e despesas do TP'));
  }
  const ler = realizado ? deps.lerDespesas : deps.lerReceitasDespesas;
  const tp = (await ler(ctx, {})).tps.find((t) => mesmoTp(t.numero, c.tp!));
  if (!tp) return semDado(MENSAGENS_PERGUNTE.TP_SEM_REALIZADO(c.tp!));
  const periodo = periodoDoTp(tp, c.ano);
  if (!periodo) return semDado(MENSAGENS_PERGUNTE.ANO_FORA_DA_VIGENCIA(tp.numero, c.ano!));
  // O ano inteiro: "em 2027"; cortado pela vigência ou sem ano: o período efetivo, por extenso.
  const anoInteiro = c.ano !== null && periodo.de === `${c.ano}-01` && periodo.ate === `${c.ano}-12`;
  const quando = anoInteiro ? `em ${c.ano}` : `de ${mesPorExtenso(periodo.de)} a ${mesPorExtenso(periodo.ate)}`;
  const link = `${realizado ? '/rel/despesas-tp' : '/rel/receitas-despesas-tp'}?${new URLSearchParams({ tp: tp.numero, ...periodo }).toString()}`;
  if (realizado) {
    const t = await deps.lerDespesas(ctx, { tp: tp.numero, ...periodo });
    const fonte = 'Demonstrativo de despesas do TP';
    if (!t.relatorio) return semDado(t.erro ?? MENSAGENS_PERGUNTE.TP_SEM_REALIZADO(tp.numero), fonte, link);
    const total = Dinheiro.de(t.relatorio.totalGeral.total);
    const carga = t.relatorio.atualizadoEm ? `realizado atualizado em ${dataBrasilia(t.relatorio.atualizadoEm)}` : 'ainda sem carga do realizado';
    // As ressalvas que a tela mostra, para o número não parecer completo.
    const fora = t.relatorio.foraDaArvore.quantidade + t.relatorio.pendencias.quantidade;
    const ressalva = fora > 0 ? `; ${fora} lançamento(s) fora do total (pendências da carga ou conta fora das despesas), ver a tela` : '';
    return { tipo: 'NUMERO', texto: `O realizado do TP ${tp.numero} ${quando} é ${total.formatar()}.`, valor: total.paraString(), fonte: `${fonte}, ${carga}${ressalva}`, link };
  }
  const t = await deps.lerReceitasDespesas(ctx, { tp: tp.numero, ...periodo });
  const fonte = 'Demonstrativo de receitas e despesas do TP';
  if (!t.relatorio) return semDado(t.erro ?? MENSAGENS_PERGUNTE.TP_SEM_REALIZADO(tp.numero), fonte, link);
  if (t.relatorio.versaoPrevisto === null) return semDado(MENSAGENS_PERGUNTE.SEM_PREVISTO(tp.numero), fonte, link);
  const { previsto, realizado: r, saldo } = t.relatorio.totalGeral.total;
  const [p, x, s, anterior] = [Dinheiro.de(previsto), Dinheiro.de(r), Dinheiro.de(saldo), Dinheiro.de(t.relatorio.saldoAnterior)];
  const semPessoal = t.relatorio.previstoSemPessoal || t.relatorio.pessoalNaoHomologado ? '; o previsto está sem o custo do pessoal, ver a tela' : '';
  return {
    tipo: 'NUMERO',
    // O saldo é acumulado desde o início do TP (RN0391/0392): com saldo anterior, a frase mostra a parcela.
    texto: anterior.ehZero()
      ? `O saldo do TP ${tp.numero} ${quando} é ${s.formatar()}: previsto ${p.formatar()} e realizado ${x.formatar()}.`
      : `O saldo acumulado do TP ${tp.numero} até ${mesPorExtenso(periodo.ate)} é ${s.formatar()}: saldo anterior ${anterior.formatar()}, mais previsto ${p.formatar()} e menos realizado ${x.formatar()} ${quando}.`,
    valor: s.paraString(),
    fonte: `${fonte}, previsto da versão oficializada ${t.relatorio.versaoPrevisto}${semPessoal}`,
    link,
  };
}

/** Executa a consulta do catálogo com o ctx de quem pergunta (as permissões e o escopo das telas). */
export async function executarConsulta(
  ctx: ContextoRequisicao,
  c: Classificacao,
  deps: Pick<DepsPergunte, 'lerVisao' | 'lerConsolidado' | 'lerDespesas' | 'lerReceitasDespesas'>,
): Promise<Resposta> {
  if (c.consulta === 'NAO_SEI') return { tipo: 'NAO_SEI', texto: MENSAGENS_PERGUNTE.NAO_SEI };
  try {
    if (c.consulta === 'REALIZADO_TP' || c.consulta === 'SALDO_TP') return await consultaDoTp(ctx, c, deps);
    if (c.consulta === 'VALOR_GLOBAL_TP' || c.consulta === 'QUANTIDADE_TPS') {
      if (!ctx.permissoes.has(PERMISSAO_CONSOLIDADO)) return semDado(MENSAGENS_PERGUNTE.SEM_ACESSO_CONSOLIDADO);
      const linhas = await deps.lerConsolidado(ctx);
      const fonte = 'Consolidado dos TPs';
      const link = '/orc/consolidado';
      if (c.consulta === 'QUANTIDADE_TPS') {
        return { tipo: 'NUMERO', texto: `Há ${linhas.length} Termo(s) de Parceria no consolidado.`, valor: String(linhas.length), fonte, link };
      }
      const tp = linhas.find((t) => mesmoTp(t.numero, c.tp!));
      if (!tp) return semDado(MENSAGENS_PERGUNTE.TP_FORA(c.tp!), fonte, link);
      // O mesmo número da tela do link: só o Valor Global oficial (D-P31-2); rascunho não tem.
      if (tp.orcado === null || tp.versaoOficial === null) return semDado(MENSAGENS_PERGUNTE.TP_NAO_OFICIAL(tp.numero), fonte, link);
      return {
        tipo: 'NUMERO',
        texto: `O Valor Global oficial do TP ${tp.numero} é ${tp.orcado.formatar()} (versão ${tp.versaoOficial}).`,
        valor: tp.orcado.paraString(),
        fonte: `${fonte}, versão oficializada ${tp.versaoOficial}`,
        link,
      };
    }

    if (!ctx.permissoes.has(PERMISSAO_ORCAMENTO)) return semDado(MENSAGENS_PERGUNTE.SEM_ACESSO_ORCAMENTO);
    // Sem ano na pergunta, o exercício que a tela abre (o mais recente); com ano, só ele.
    const v = await deps.lerVisao(ctx, c.ano);
    if (!v) return semDado(c.ano === null ? MENSAGENS_PERGUNTE.SEM_NENHUM_EXERCICIO : MENSAGENS_PERGUNTE.SEM_EXERCICIO(c.ano));
    if (c.ano !== null && v.exercicio.ano !== c.ano) return semDado(MENSAGENS_PERGUNTE.SEM_EXERCICIO(c.ano));
    const ano = v.exercicio.ano;
    const link = `/orc/orcamento?ano=${ano}`;
    const escopo = v.escopo.tipo === 'TOTAL' ? '' : ` (do seu escopo, CC ${v.escopo.raiz})`;
    const fonte = `Orçamento da Administração Central, exercício ${ano} (${v.exercicio.rotuloSituacao})`;
    const numero = (texto: string, valor: Dinheiro, l = link): Resposta => ({ tipo: 'NUMERO', texto: `${texto} ${valor.formatar()}${escopo}.`, valor: valor.paraString(), fonte, link: l });
    switch (c.consulta) {
      case 'ORCAMENTO_ADM_CENTRAL':
        return numero(`O orçamento da Administração Central em ${ano} é`, v.indicadores.orcamentoAno);
      case 'PESSOAL_ADM_CENTRAL':
        return numero(`O custo de pessoal orçado da Administração Central em ${ano} é`, v.indicadores.pessoal);
      case 'TETO_ADM_CENTRAL':
        return v.painel ? numero(`O teto da Administração Central em ${ano} é`, v.painel.tetoEfetivo) : semDado(MENSAGENS_PERGUNTE.SO_INTEIRA, fonte, link);
      case 'SALDO_ADM_CENTRAL':
        return v.painel ? numero(`O saldo entre o teto e o orçado em ${ano} é`, v.painel.saldo) : semDado(MENSAGENS_PERGUNTE.SO_INTEIRA, fonte, link);
      case 'RESULTADO_ADM_CENTRAL':
        return v.painel ? numero(`O resultado do ano (receita menos despesa) em ${ano} é`, v.painel.resultadoAno) : semDado(MENSAGENS_PERGUNTE.SO_INTEIRA, fonte, link);
      case 'ORCADO_CC': {
        const no = acharCc(v.arvore, c.cc!);
        if (!no) return semDado(MENSAGENS_PERGUNTE.CC_FORA(c.cc!), fonte, link);
        return numero(`O orçado do centro de custo ${no.cc} – ${no.descricao} em ${ano} é`, no.total, `${link}&cc=${encodeURIComponent(no.cc)}`);
      }
    }
  } catch (x) {
    // CC fora do escopo, exercício excluído entre leituras etc.: a recusa das telas, sem detalhe. A negação de
    // permissão (ErroPermissao) sobe, para o definirAcao auditá-la.
    if (x instanceof ErroDominio) return semDado('Não foi possível consultar esse número com o seu acesso.');
    throw x;
  }
}

/** O campo de pergunta aparece? A permissão do caso, a chave geral, o caso ativo e os tetos. */
export function pergunteLiberado(ctx: ContextoRequisicao, deps: Partial<Pick<DepsPergunte, 'ia'>> = {}): Promise<boolean> {
  return (deps.ia ?? servicoIA).disponivel(ctx, CASO_PERGUNTE_SGO);
}

export async function perguntarAoSgo(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsPergunte> = {}): Promise<Resultado<Resposta>> {
  if (!ctx.permissoes.has(PERMISSAO_IA)) return erro(new ErroIA('ia.sem_permissao').message);
  // Sem nenhuma fonte de dados, nem chama a IA (não há o que responder).
  const algumaFonte =
    ctx.permissoes.has(PERMISSAO_ORCAMENTO) ||
    ctx.permissoes.has(PERMISSAO_CONSOLIDADO) ||
    veRealizado(ctx, PERMISSAO_DESPESAS) ||
    veRealizado(ctx, PERMISSAO_RECEITAS_DESPESAS);
  if (!algumaFonte) return erro(MENSAGENS_PERGUNTE.SEM_ACESSO);
  const pergunta = validarPergunta((bruto as { pergunta?: unknown } | null)?.pergunta);
  if (!pergunta.ok) return pergunta;
  const deps = resolver(depsParciais);
  const anoAtual = Number(mesEmBrasilia(deps.agora()).slice(0, 4));
  const sinal = deps.sinalIa();
  let classificacao: Classificacao;
  try {
    const r = await deps.ia.gerarEstruturado(ctx, CASO_PERGUNTE_SGO, mensagemPergunta(pergunta.valor, anoAtual), SAIDA, sinal);
    classificacao = conferirClassificacao(r.valor);
  } catch (x) {
    if (!(x instanceof ErroIA)) throw x;
    return erro(x.codigo === 'ia.cancelada' && tempoEsgotado(sinal) ? MENSAGENS_PERGUNTE.TEMPO_ESGOTADO : x.message);
  }
  return ok(await executarConsulta(ctx, classificacao, deps));
}
