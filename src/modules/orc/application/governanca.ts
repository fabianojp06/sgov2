import { auditar } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { ErroDominio } from '@/shared/kernel';
import { contextoAuditoria } from './calculo-linhas';
import type { DepsOrc } from './deps';

// ORIGEM BLINDADA (spec §5; Global Constraints do plano do P6): campos calculados ou de controle
// nunca vêm do payload. A casca de cada caso de uso confere as chaves do payload bruto antes do
// parse (os schemas são .strict()), audita a tentativa numa transação própria (a operação é
// desfeita) e recusa.
export const CAMPOS_ORIGEM_BLINDADA = {
  exercicio: ['situacao', 'versaoPremissas', 'enviadoPor', 'oficializadoEm', 'tetoEfetivo'],
  receita: ['origem', 'total', 'liquido', 'iss', 'importacaoId'],
  // D-P11-5: a tela altera pacote de qualquer origem, mas nunca muda a origem, a importação nem o
  // exercício (o da inclusão vem do formulário); valor anual e parcelas são sempre do servidor.
  pacote: ['origem', 'importacaoId', 'exercicioId', 'valorAnual', 'meses', 'linhas'],
  // D-P12-7: a mesma regra para a posição de pessoal; as linhas são sempre do motor (C33).
  posicao: ['origem', 'importacaoId', 'exercicioId', 'linhas'],
  // Proposta de TP (US-065, D-P17-4 e D-P17-6): o Valor Global é sempre calculado (RN_TP_003); a
  // situação, a versão e a unidade são do servidor.
  proposta: ['valorGlobal', 'situacao', 'versaoAtual', 'unidadeId', 'versao'],
  // Meta da proposta (US-067, D-P19-3): tipo e proposta vêm da capa (RN0140); a versão da proposta, a
  // unidade e os totais são do servidor. No alterar, o número também (UC03.16, passo 4).
  meta: ['tipo', 'unidadeId', 'versaoPropostaId', 'valorGlobal', 'totalMetas', 'saldo'],
  // Pessoal da proposta (US-070, D-P20-2 e D-P20-6): a ordem, o salário herdado do cargo, os custos e as
  // quantidades são do servidor (RN0242, RN_EMP_007, RN0457). No alterar, a meta também (UC03.22 e UC03.26).
  empregado: ['tipo', 'unidadeId', 'versaoPropostaId', 'ordem', 'salarioMensal', 'custoMensal', 'custoPeriodo'],
  qtde: ['tipo', 'unidadeId', 'versaoPropostaId', 'empregados', 'estagiarios', 'jovensAprendizes'],
} as const satisfies Record<string, readonly string[]>;

export async function recusarCamposBlindados(
  ctx: ContextoRequisicao,
  funcionalidade: string,
  bruto: unknown,
  campos: readonly string[],
  deps: Pick<DepsOrc, 'cliente'>,
): Promise<void> {
  if (typeof bruto !== 'object' || bruto === null) return;
  const chaves = bruto instanceof FormData ? [...new Set(bruto.keys())] : Object.keys(bruto);
  const proibidos = chaves.filter((k) => campos.includes(k));
  if (proibidos.length === 0) return;
  await deps.cliente.$transaction((tx) =>
    auditar(tx, {
      contexto: contextoAuditoria(ctx),
      funcionalidade,
      tipo: 'SISTEMA',
      origem: 'SISTEMA',
      descricao: `Tentativa de gravar campo de origem blindada: ${proibidos.join(', ')}`,
    }),
  );
  throw new ErroDominio('orc.violacao_governanca', `Operação recusada: o campo ${proibidos.join(', ')} não pode ser informado.`);
}
