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
