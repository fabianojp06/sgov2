import { z } from 'zod';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { ErroIA } from '@/shared/ia';
import { falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { MENSAGENS_ORC } from '../domain/mensagens';
import type { SugestaoContaCc } from '../domain/sugestao-ia';
import { semMarcas } from '../domain/texto';
import { errosNaoEditavel } from './calculo-linhas';
import { CASOS_IA_ORC } from './ia-casos';
import { mensagemErroIA, resolverDepsIa, type DepsIaOrc } from './ia-deps';
import { consultarSugestaoConta } from './ia-sugestao-conta-consulta';
import { opcoesPacote } from './pacotes';

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
// (vetada, sintética, inexistente, CC fora do escopo) é descartada na consulta (ia-sugestao-conta-consulta.ts,
// a mesma da avaliação no worker), e a tela só mostra o que sobra.

const CASO = CASOS_IA_ORC.sugestaoConta;
const PERMISSAO_IA = `${CASO.funcionalidade}:executar`;
const FUNCIONALIDADE_PACOTES = 'orc.pacotes';
const MINIMO_DESCRICAO = 10;
const MAXIMO_DESCRICAO = 1000;

const ENTRADA = z.object({ exercicioId: z.string(), descricao: z.string().optional() }).strict();

const erro = (campo: string, mensagem: string): Resultado<never> => falha([{ campo, mensagem } satisfies ErroCampo]);
const contar = (t: string) => [...t].length;

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
