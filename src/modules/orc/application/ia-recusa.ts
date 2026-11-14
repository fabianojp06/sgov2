import { z } from 'zod';
import { obterTarefa } from '@/modules/apr';
import type { ContextoRequisicao } from '@/shared/authz';
import { ErroIA } from '@/shared/ia';
import { falha, ok, type Resultado } from '@/shared/kernel';
import { semMarcas } from '../domain/texto';
import { CASOS_IA_ORC } from './ia-casos';
import { mensagemErroIA, resolverDepsIa, type DepsIaOrc } from './ia-deps';
import { manipuladorWa01 } from './oficializacao';

// Ajuda da IA para redigir a recusa da oficialização (US-084, Task 2; IA-13 da spec §6.8; plano do P30, D-P30-6).
// Só leitura: a sugestão volta para o campo da justificativa, e a rejeição passa pelo decidirSolicitacao do apr,
// com a marca SUGESTAO_IA no Histórico quando o texto aceito é usado sem mudança. A tarefa é lida pelo apr
// (obterTarefa: só a do próprio aprovador, com a RLS), com o resumo do manipulador do WA01.
//
// Minimização (spec §4.4): a mensagem leva a descrição da solicitação, os itens do resumo (o que o aprovador
// já vê) e o rascunho dele, entre as marcas. Nunca o nome de quem enviou nem de quem decide.

const CASO = CASOS_IA_ORC.recusa;
const PERMISSAO_IA = `${CASO.funcionalidade}:executar`;
const MAXIMO_RASCUNHO = 2000;

export type SugestaoRecusa = { texto: string; pontos: readonly string[] };

const ENTRADA = z.object({ id: z.string(), rascunho: z.string().optional() }).strict();
export const RESPOSTA_RECUSA = z.object({
  texto: z.string().trim().min(15).max(1000),
  pontos: z.array(z.string().trim().min(1).max(300)).max(5),
});

const erro = (mensagem: string): Resultado<never> => falha([{ campo: '_', mensagem }]);

export function montarMensagemRecusa(descricao: string, resumo: readonly { rotulo: string; valor: string }[], rascunho: string): string {
  return [
    `Solicitação: ${descricao}`,
    'Resumo da proposta:',
    ...resumo.map((r) => `- ${r.rotulo}: ${r.valor}`),
    rascunho === '' ? 'O aprovador ainda não escreveu o rascunho.' : 'Rascunho do aprovador:',
    ...(rascunho === '' ? [] : ['<<<', rascunho, '>>>']),
  ].join('\n');
}

export async function sugerirRecusa(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsIaOrc> = {}): Promise<Resultado<SugestaoRecusa>> {
  if (!ctx.permissoes.has(PERMISSAO_IA)) return erro(new ErroIA('ia.sem_permissao').message);
  const deps = resolverDepsIa(depsParciais);
  const parse = ENTRADA.safeParse(bruto);
  if (!parse.success) return erro('Dados da tarefa inválidos. Recarregue a tela.');
  const rascunho = semMarcas(parse.data.rascunho ?? '').trim();
  if ([...rascunho].length > MAXIMO_RASCUNHO) return erro(`O rascunho pode ter no máximo ${MAXIMO_RASCUNHO} caracteres.`);
  // Só a tarefa do próprio aprovador, do WA01 e ainda pendente (D-P30-6).
  const aberta = await obterTarefa(ctx, parse.data.id, { WA01: manipuladorWa01(deps) }, { cliente: deps.cliente });
  if (!aberta || aberta.tarefa.fluxo !== 'WA01' || aberta.tarefa.situacao !== 'EM_APROVACAO') return erro('A ajuda da IA vale só para a oficialização pendente que é sua. Recarregue a Central de Tarefas.');
  const sinal = deps.sinalIa();
  try {
    const { valor } = await deps.ia.gerarEstruturado(ctx, CASO, montarMensagemRecusa(aberta.tarefa.descricao, aberta.resumo, rascunho), RESPOSTA_RECUSA, sinal);
    return ok({ texto: valor.texto, pontos: valor.pontos });
  } catch (x) {
    if (!(x instanceof ErroIA)) throw x;
    return erro(mensagemErroIA(x, sinal));
  }
}
