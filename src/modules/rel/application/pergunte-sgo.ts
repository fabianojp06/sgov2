import 'server-only';
import { z } from 'zod';
import { obterConsolidado, obterVisaoExercicio, type VisaoExercicio } from '@/modules/orc';
import type { ContextoRequisicao } from '@/shared/authz';
import { ErroIA, servicoIA, type ServicoIA } from '@/shared/ia';
import { Dinheiro, ErroDominio, falha, ok, type Resultado } from '@/shared/kernel';
import { conferirClassificacao, mensagemPergunta, mesmoCc, mesmoTp, validarPergunta, type Classificacao, type Resposta } from '../domain/pergunte-sgo';
import { mesEmBrasilia } from '../domain/relatorio-executivo';
import { CASO_PERGUNTE_SGO } from './ia-casos';

// Pergunte ao SGO (US-104, IA-16), parte 1. A IA só classifica a pergunta numa consulta do catálogo (com o
// ano, o CC ou o TP); o SISTEMA executa a consulta pelas portas públicas do orc, as MESMAS das telas do link
// (orçamento: obterVisaoExercicio; TPs: obterConsolidado), com o ctx de quem pergunta (as mesmas permissões,
// o escopo do Gestor e a RLS), e monta a resposta com o número, a fonte e o link. Nada é gravado além da
// chamada (ia_chamada) e do que as portas já registram (a CONSULTA do consolidado).

export const TEMPO_LIMITE_PERGUNTA_MS = 30_000;
const PERMISSAO_IA = `${CASO_PERGUNTE_SGO.funcionalidade}:executar`;
const PERMISSAO_ORCAMENTO = 'orc.orcamento:consultar';
const PERMISSAO_CONSOLIDADO = 'orc.consolidado:consultar';

export const MENSAGENS_PERGUNTE = {
  NAO_SEI:
    'Ainda não sei responder a essa pergunta. Por enquanto, respondo sobre o orçamento, o pessoal, o teto, o saldo e o resultado da Administração Central, o orçado de um centro de custo e o Valor Global dos Termos de Parceria.',
  SEM_ACESSO: 'O seu perfil não consulta o orçamento da Administração Central nem o Consolidado dos TPs.',
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
export type DepsPergunte = { ia: ServicoIA; sinalIa: () => AbortSignal; agora: () => Date; lerVisao: LerVisao; lerConsolidado: LerConsolidado };

const LER_VISAO: LerVisao = (ctx, ano) => obterVisaoExercicio(ctx, ano, null);
const LER_CONSOLIDADO: LerConsolidado = async (ctx) => (await obterConsolidado(ctx)).linhas;
const resolver = (d: Partial<DepsPergunte>): DepsPergunte => ({
  ia: d.ia ?? servicoIA,
  sinalIa: d.sinalIa ?? (() => AbortSignal.timeout(TEMPO_LIMITE_PERGUNTA_MS)),
  agora: d.agora ?? (() => new Date()),
  lerVisao: d.lerVisao ?? LER_VISAO,
  lerConsolidado: d.lerConsolidado ?? LER_CONSOLIDADO,
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

/** Executa a consulta do catálogo com o ctx de quem pergunta (as permissões e o escopo das telas). */
export async function executarConsulta(ctx: ContextoRequisicao, c: Classificacao, deps: Pick<DepsPergunte, 'lerVisao' | 'lerConsolidado'>): Promise<Resposta> {
  if (c.consulta === 'NAO_SEI') return { tipo: 'NAO_SEI', texto: MENSAGENS_PERGUNTE.NAO_SEI };
  try {
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
  if (!ctx.permissoes.has(PERMISSAO_ORCAMENTO) && !ctx.permissoes.has(PERMISSAO_CONSOLIDADO)) return erro(MENSAGENS_PERGUNTE.SEM_ACESSO);
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
