import { z } from 'zod';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { ErroIA } from '@/shared/ia';
import { ErroDominio, falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { editavel, type SituacaoExercicio } from '../domain/exercicio';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { FALTANDO_JUSTIFICATIVA, ROTULO_PRIORIDADE, type SugestaoJustificativa } from '../domain/sugestao-ia';
import { errosNaoEditavel } from './calculo-linhas';
import { contasVetadasEmPacote } from './contas-vetadas';
import { CASOS_IA_ORC } from './ia-casos';
import { mensagemErroIA, resolverDepsIa, type DepsIaOrc } from './ia-deps';
import { resolverEscopo } from './escopo';

// Ajuda da IA na justificativa do pacote base zero (US-063; plano do P14, Task 1). Só leitura: a
// sugestão volta para o formulário, e a gravação passa por incluirPacote/alterarPacote, com a marca
// SUGESTAO_IA no Histórico quando a pessoa aceitou (D-P14-3). A chamada vai pelo servicoIA, que
// aplica a permissão do caso, as chaves, os limites e o registro (US-019).
//
// Minimização (spec §4.4): a mensagem é montada aqui, só com dados do pacote (exercício, CC e conta
// com as descrições, prioridade, quantidade, valor unitário, distribuição e a justificativa
// digitada). Nunca leva nome, login ou e-mail de quem pede.

const CASO = CASOS_IA_ORC.justificativa;
const PERMISSAO_IA = `${CASO.funcionalidade}:executar`;
const FUNCIONALIDADE_PACOTES = 'orc.pacotes';
const MAXIMO_JUSTIFICATIVA = 1000;

const texto = z.string().optional();
const ENTRADA = z
  .object({
    exercicioId: z.string(),
    cc: texto,
    conta: texto,
    justificativa: texto,
    prioridade: texto,
    quantidade: texto,
    valorUnitario: texto,
    distribuicao: texto,
  })
  .strict();

// Resposta da IA: fora do schema, o provedor devolve ErroIA('ia.saida_invalida').
export const RESPOSTA_JUSTIFICATIVA = z.object({
  texto: z.string().trim().min(10).max(MAXIMO_JUSTIFICATIVA),
  faltando: z.array(z.enum(FALTANDO_JUSTIFICATIVA)).max(FALTANDO_JUSTIFICATIVA.length),
  prioridade: z.enum(['ESSENCIAL', 'IMPORTANTE', 'DESEJAVEL']),
  motivoPrioridade: z.string().trim().min(1).max(500),
});

const erro = (campo: string, mensagem: string): Resultado<never> => falha([{ campo, mensagem } satisfies ErroCampo]);
const contar = (t: string) => [...t].length;

type No = { classificacao: string; descricao: string; filhos: readonly No[] };
function descricao(nos: readonly No[], classificacao: string): string | null {
  for (const n of nos) {
    if (n.classificacao === classificacao) return n.descricao;
    const achada = descricao(n.filhos, classificacao);
    if (achada !== null) return achada;
  }
  return null;
}

// Só o que segue o formato da tela vai para a IA: um campo malformado fica de fora, não é corrigido.
const PRIORIDADES = new Set(Object.values(ROTULO_PRIORIDADE));
const QUANTIDADE = /^\d{1,4}$/;
const VALOR_BR = /^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/;
// As marcas que cercam o texto digitado não podem aparecer dentro dele. Repete até não mudar: tirar
// uma marca pode juntar os pedaços de outra ('<<>>><' → '<<<').
export function semMarcas(t: string): string {
  let atual = t;
  for (;;) {
    const limpo = atual.replaceAll('<<<', '').replaceAll('>>>', '');
    if (limpo === atual) return limpo;
    atual = limpo;
  }
}

type DadosMensagem = {
  ano: number;
  cc: string;
  descricaoCc: string;
  conta: string | null;
  descricaoConta: string | null;
  prioridade?: string | undefined;
  quantidade?: string | undefined;
  valorUnitario?: string | undefined;
  distribuicao?: string | undefined;
  justificativa: string;
};

export function montarMensagemJustificativa(d: DadosMensagem): string {
  const linhas = [
    `Exercício do orçamento: ${d.ano}`,
    `Centro de custo: ${d.cc} – ${d.descricaoCc}`,
    d.conta ? `Conta: ${d.conta} – ${d.descricaoConta ?? ''}` : 'Conta: ainda não escolhida',
  ];
  const p = d.prioridade?.trim();
  if (p && PRIORIDADES.has(p)) linhas.push(`Prioridade marcada: ${p}`);
  const q = d.quantidade?.trim();
  if (q && QUANTIDADE.test(q)) linhas.push(`Quantidade: ${q}`);
  const v = d.valorUnitario?.trim();
  if (v && VALOR_BR.test(v)) linhas.push(`Valor unitário: R$ ${v}`);
  const dist = d.distribuicao?.trim();
  if (dist === 'Mensal' || dist === 'Pontual') linhas.push(`Distribuição: ${dist === 'Mensal' ? 'mensal (12 parcelas)' : 'pontual (um mês)'}`);
  linhas.push('Justificativa digitada:', '<<<', semMarcas(d.justificativa), '>>>');
  return linhas.join('\n');
}

export async function sugerirJustificativa(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsIaOrc> = {}): Promise<Resultado<SugestaoJustificativa>> {
  // A governança também confere; aqui, antes de qualquer leitura, com a mensagem do ErroIA.
  if (!ctx.permissoes.has(PERMISSAO_IA)) return erro('_', new ErroIA('ia.sem_permissao').message);
  // Quem não lança pacote não tem o que justificar (D-P14-4).
  if (!ctx.permissoes.has(`${FUNCIONALIDADE_PACOTES}:incluir`) && !ctx.permissoes.has(`${FUNCIONALIDADE_PACOTES}:alterar`)) {
    throw new ErroPermissao(FUNCIONALIDADE_PACOTES, 'incluir');
  }
  const deps = resolverDepsIa(depsParciais);
  const parse = ENTRADA.safeParse(bruto);
  if (!parse.success) return erro('_', 'Dados do pacote inválidos. Recarregue a tela.');
  const entrada = parse.data;
  // As marcas saem antes de contar: '<<<>>>' e espaços não valem como texto.
  const justificativa = semMarcas(entrada.justificativa ?? '').trim();
  if (contar(justificativa) < 10) return erro('justificativa', MENSAGENS_ORC.JUSTIFICATIVA_CURTA);
  if (contar(justificativa) > MAXIMO_JUSTIFICATIVA) return erro('justificativa', 'Justificativa com mais de 1000 caracteres.');

  const indice = await deps.estrutura.carregarIndiceEstrutura(deps.cliente);
  const escopo = await resolverEscopo(deps.cliente, ctx, indice, deps);
  const e = z.uuid().safeParse(entrada.exercicioId).success ? await deps.cliente.orcamentoExercicio.findUnique({ where: { id: entrada.exercicioId } }) : null;
  if (!e) throw new ErroDominio('orc.exercicio_inexistente', 'Exercício não encontrado.');
  if (!editavel(e.situacao as SituacaoExercicio)) return falha(errosNaoEditavel(e.situacao as SituacaoExercicio));

  // O CC e a conta passam pelas mesmas regras do formulário, antes de qualquer chamada à IA.
  const cc = (entrada.cc ?? '').trim();
  if (cc === '') return erro('cc', MENSAGENS_ORC.CC_OBRIGATORIO);
  if (!indice.centroCustoAnalitico(cc)) return erro('cc', MENSAGENS_ORC.CC_NAO_ANALITICO);
  if (escopo.tipo !== 'TOTAL' && !escopo.ccs.has(cc)) return erro('cc', MENSAGENS_ORC.CC_FORA_DO_ESCOPO);
  const conta = (entrada.conta ?? '').trim();
  if (conta !== '') {
    const premissas = await deps.custoPessoal.obterPremissasExercicio(deps.cliente, e.ano);
    if (!indice.contaAnaliticaAtiva(conta) || contasVetadasEmPacote(indice, premissas).has(conta)) return erro('conta', MENSAGENS_ORC.CONTA_NAO_PERMITIDA);
  }
  const [ccs, contas] = await Promise.all([deps.estrutura.listarArvoreCentrosCusto(deps.cliente), deps.estrutura.listarArvoreContas(deps.cliente)]);

  const mensagem = montarMensagemJustificativa({
    ano: e.ano,
    cc,
    descricaoCc: descricao(ccs, cc) ?? '',
    conta: conta === '' ? null : conta,
    descricaoConta: conta === '' ? null : descricao(contas, conta),
    prioridade: entrada.prioridade,
    quantidade: entrada.quantidade,
    valorUnitario: entrada.valorUnitario,
    distribuicao: entrada.distribuicao,
    justificativa,
  });
  const sinal = deps.sinalIa();
  try {
    const { valor } = await deps.ia.gerarEstruturado(ctx, CASO, mensagem, RESPOSTA_JUSTIFICATIVA, sinal);
    return ok({
      texto: valor.texto,
      // Na ordem fixa e sem repetição.
      faltando: FALTANDO_JUSTIFICATIVA.filter((f) => valor.faltando.includes(f)),
      prioridade: valor.prioridade,
      motivoPrioridade: valor.motivoPrioridade,
    });
  } catch (x) {
    // definirAcao só traduz ErroDominio: o ErroIA vira aqui a mensagem fixa dele (sem detalhe do provedor).
    if (!(x instanceof ErroIA)) throw x;
    return erro('_', mensagemErroIA(x, sinal));
  }
}
