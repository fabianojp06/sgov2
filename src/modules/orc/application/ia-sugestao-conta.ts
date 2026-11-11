import { z } from 'zod';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { ErroIA, type QuemPedeIA, type ServicoIA } from '@/shared/ia';
import { falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { MENSAGENS_ORC } from '../domain/mensagens';
import type { SugestaoContaCc } from '../domain/sugestao-ia';
import { errosNaoEditavel } from './calculo-linhas';
import { CASOS_IA_ORC } from './ia-casos';
import { mensagemErroIA, resolverDepsIa, type DepsIaOrc } from './ia-deps';
import { semMarcas } from './ia-justificativa';
import { opcoesPacote, type OpcaoEstrutura } from './pacotes';

// Sugestão de conta e CC pela descrição do gasto (US-062; plano do P14, Task 2 e D-P14-2). Só leitura:
// as opções voltam para o formulário, e a gravação passa por incluirPacote/alterarPacote, com a marca
// SUGESTAO_IA no Histórico quando a pessoa aceitou (D-P14-3). A chamada vai pelo servicoIA, que
// aplica a permissão do caso, as chaves, os limites e o registro (US-019).
//
// Minimização (spec §4.4): a mensagem leva só a descrição do gasto digitada e as listas de contas e de
// CCs que o formulário oferece (opcoesPacote: contas analíticas ativas sem as vetadas; CCs do escopo),
// com classificação e descrição. Nunca leva nome, login ou e-mail de quem pede.
//
// Conferência (Review Focus 2): a resposta da IA nunca é usada como veio. Conta ou CC fora das listas
// (vetada, sintética, inexistente, CC fora do escopo) é descartada aqui, e a tela só mostra o que sobra.

const CASO = CASOS_IA_ORC.sugestaoConta;
const PERMISSAO_IA = `${CASO.funcionalidade}:executar`;
const FUNCIONALIDADE_PACOTES = 'orc.pacotes';
const MINIMO_DESCRICAO = 10;
const MAXIMO_DESCRICAO = 1000;
export const MAXIMO_CONTAS_SUGERIDAS = 3;

const ENTRADA = z.object({ exercicioId: z.string(), descricao: z.string().optional() }).strict();

// trim no schema: motivo só de espaços fica fora do formato.
const motivo = z.string().trim().min(1).max(500);
// Resposta da IA: fora do schema, o provedor devolve ErroIA('ia.saida_invalida').
export const RESPOSTA_SUGESTAO_CONTA = z.object({
  contas: z
    .array(z.object({ conta: z.string().trim().max(40), motivo }))
    .min(1)
    .max(MAXIMO_CONTAS_SUGERIDAS),
  cc: z.object({ cc: z.string().trim().max(40), motivo }).nullable(),
});

/** As listas que a IA pode usar: as mesmas do formulário do pacote. */
export type ListasSugestao = { contas: readonly OpcaoEstrutura[]; ccs: readonly OpcaoEstrutura[] };

const erro = (campo: string, mensagem: string): Resultado<never> => falha([{ campo, mensagem } satisfies ErroCampo]);
const contar = (t: string) => [...t].length;
const linha = (o: OpcaoEstrutura) => `${o.classificacao} – ${semMarcas(o.descricao)}`;

export function montarMensagemSugestaoConta(descricao: string, listas: ListasSugestao): string {
  return [
    'Descrição do gasto digitada:',
    '<<<',
    semMarcas(descricao),
    '>>>',
    '',
    'Contas permitidas (classificação – descrição):',
    ...listas.contas.map(linha),
    '',
    'Centros de custo permitidos (classificação – descrição):',
    ...(listas.ccs.length > 0 ? listas.ccs.map(linha) : ['nenhum: responda sem centro de custo']),
  ].join('\n');
}

/**
 * Consulta a IA e confere a resposta contra as listas: contas fora da lista ou repetidas saem (a ordem
 * da IA fica), e um CC fora da lista vira null. Pode voltar sem nenhuma conta. Lança o ErroIA. Usada
 * pelo caso de uso e pela avaliação (D-P14-9), para as duas medirem a mesma coisa.
 */
export async function consultarSugestaoConta(ia: ServicoIA, quem: QuemPedeIA, descricao: string, listas: ListasSugestao, sinal?: AbortSignal): Promise<SugestaoContaCc> {
  const { valor } = await ia.gerarEstruturado(quem, CASO, montarMensagemSugestaoConta(descricao, listas), RESPOSTA_SUGESTAO_CONTA, sinal);
  const contas = new Map(listas.contas.map((c) => [c.classificacao, c.descricao]));
  const ccs = new Map(listas.ccs.map((c) => [c.classificacao, c.descricao]));
  const vistas = new Set<string>();
  const validas: { conta: string; descricao: string; motivo: string }[] = [];
  for (const s of valor.contas) {
    const conta = s.conta;
    const desc = contas.get(conta);
    if (desc === undefined || vistas.has(conta)) continue;
    vistas.add(conta);
    validas.push({ conta, descricao: desc, motivo: s.motivo });
  }
  const cc = valor.cc?.cc ?? '';
  const descCc = ccs.get(cc);
  return { contas: validas, cc: valor.cc && descCc !== undefined ? { cc, descricao: descCc, motivo: valor.cc.motivo } : null };
}

export async function sugerirContaCc(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsIaOrc> = {}): Promise<Resultado<SugestaoContaCc>> {
  // A governança também confere; aqui, antes de qualquer leitura, com a mensagem do ErroIA.
  if (!ctx.permissoes.has(PERMISSAO_IA)) return erro('_', new ErroIA('ia.sem_permissao').message);
  // Quem não lança pacote não tem conta a escolher (D-P14-4).
  if (!ctx.permissoes.has(`${FUNCIONALIDADE_PACOTES}:incluir`) && !ctx.permissoes.has(`${FUNCIONALIDADE_PACOTES}:alterar`)) {
    throw new ErroPermissao(FUNCIONALIDADE_PACOTES, 'incluir');
  }
  const deps = resolverDepsIa(depsParciais);
  const parse = ENTRADA.safeParse(bruto);
  if (!parse.success) return erro('_', 'Dados do pacote inválidos. Recarregue a tela.');
  // As marcas saem antes de contar: '<<<>>>' e espaços não valem como descrição.
  const descricao = semMarcas(parse.data.descricao ?? '').trim();
  if (contar(descricao) < MINIMO_DESCRICAO) return erro('justificativa', MENSAGENS_ORC.IA_DESCRICAO_CURTA);
  if (contar(descricao) > MAXIMO_DESCRICAO) return erro('justificativa', 'Justificativa com mais de 1000 caracteres.');

  // As mesmas listas do formulário: contas permitidas em pacote e CCs do escopo de quem pede.
  const opcoes = await opcoesPacote(ctx, parse.data.exercicioId, deps);
  if (!opcoes.editavel) return falha(errosNaoEditavel(opcoes.situacao));
  if (opcoes.contas.length === 0) return erro('_', MENSAGENS_ORC.IA_SEM_SUGESTAO_VALIDA);

  const sinal = deps.sinalIa();
  try {
    const s = await consultarSugestaoConta(deps.ia, ctx, descricao, opcoes, sinal);
    return s.contas.length === 0 ? erro('_', MENSAGENS_ORC.IA_SEM_SUGESTAO_VALIDA) : ok(s);
  } catch (x) {
    // definirAcao só traduz ErroDominio: o ErroIA vira aqui a mensagem fixa dele (sem detalhe do provedor).
    if (!(x instanceof ErroIA)) throw x;
    return erro('_', mensagemErroIA(x, sinal));
  }
}
