import type { IndiceEstruturaFinanceira } from '@/modules/cad/servidor';
import { ErroPermissao, type Acao, type ContextoRequisicao } from '@/shared/authz';
import type { TxCliente } from '@/shared/db';
import type { DepsOrc } from './deps';

// Escopo do usuário no orçamento (C25; R8, R15 e R16 do plano do P6). Sem CC de escopo: a Adm.
// Central inteira. Com CC de escopo: só os CCs analíticos ativos da subárvore; raiz inexistente ou
// inativa dá conjunto vazio (o índice do C1 devolve []), nunca "tudo".
export type Escopo = { tipo: 'TOTAL' } | { tipo: 'SUBARVORE'; raiz: string; ccs: ReadonlySet<string> };

export async function resolverEscopo(
  tx: TxCliente,
  ctx: ContextoRequisicao,
  indice: IndiceEstruturaFinanceira,
  deps: Pick<DepsOrc, 'obterEscopo'>,
): Promise<Escopo> {
  const raiz = await deps.obterEscopo(tx, ctx.usuarioId);
  if (raiz === null) return { tipo: 'TOTAL' };
  return { tipo: 'SUBARVORE', raiz, ccs: new Set(indice.centrosCustoAnaliticosSob(raiz)) };
}

// R15: o que não é por CC (recálculo, teto, receitas, exercícios, aprovação) é só de quem vê a Adm.
// Central inteira, mesmo com a ação concedida no catálogo. A negação segue o caminho do exigir: a
// definirAcao responde 403 e a audita; a página responde 404.
export function exigirEscopoTotal(escopo: Escopo, funcionalidade: string, acao: Acao): void {
  if (escopo.tipo !== 'TOTAL') throw new ErroPermissao(funcionalidade, acao);
}

// O mesmo, sem carregar o índice do C1 (só importa haver CC de escopo). Roda antes da trava do
// exercício: quem será negado não descobre se o exercício existe nem segura a trava.
export async function exigirSemEscopo(
  tx: TxCliente,
  ctx: ContextoRequisicao,
  deps: Pick<DepsOrc, 'obterEscopo'>,
  funcionalidade: string,
  acao: Acao,
): Promise<void> {
  if ((await deps.obterEscopo(tx, ctx.usuarioId)) !== null) throw new ErroPermissao(funcionalidade, acao);
}
