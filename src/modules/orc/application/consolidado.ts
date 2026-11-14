import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { Dinheiro, Percentual } from '@/shared/kernel';
import { emTodasAsUnidades } from '@/shared/unidade';
import { ROTULO_TIPO_PROPOSTA, type SituacaoProposta, type TipoProposta } from '../domain/proposta';
import { contextoAuditoria } from './calculo-linhas';
import { resolverDeps, type DepsOrc } from './deps';

// Consolidado dos TPs (US-101; spec §6.7; plano do P31). O único lugar com vários TPs juntos: para quem tem
// orc.consolidado, todos os TPs ativos, mesmo os que a pessoa não opera, pelo caminho emTodasAsUnidades
// (transação só de leitura). Cada consulta vai ao Histórico antes da leitura (acesso auditado).

const FUNCIONALIDADE = 'orc.consolidado';

export type LinhaConsolidado = {
  numero: string;
  objeto: string;
  tipo: string;
  /** A situação da última versão. */
  situacao: SituacaoProposta;
  versaoAtual: number;
  /** D-P31-2: a versão oficializada mais recente e o Valor Global do snapshot dela; nulos se nunca oficializado. */
  versaoOficial: number | null;
  orcado: Dinheiro | null;
  /** D-P31-3: zero até a execução (F5). */
  realizado: Dinheiro;
  percentual: Percentual | null;
};

export type Consolidado = { linhas: readonly LinhaConsolidado[]; totalOrcado: Dinheiro; totalRealizado: Dinheiro; percentual: Percentual | null; oficializados: number };

export async function obterConsolidado(ctx: ContextoRequisicao, depsParciais: Partial<DepsOrc> = {}): Promise<Consolidado> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  // Sem a trilha, não há dado: o registro vem antes e numa transação própria (a da leitura não grava).
  await deps.cliente.$transaction((tx) =>
    auditar(tx, { contexto: contextoAuditoria(ctx), funcionalidade: FUNCIONALIDADE, tipo: 'CONSULTA', descricao: 'Consulta ao Consolidado dos TPs' }),
  );
  return emTodasAsUnidades(
    ctx,
    FUNCIONALIDADE,
    async (tx) => {
      const propostas = await tx.propostaTp.findMany({
        where: { excluidaEm: null, unidade: { ativo: true } },
        include: {
          unidade: { select: { codigo: true } },
          versoes: { orderBy: { numero: 'desc' }, select: { numero: true, situacao: true, snapshot: { select: { valorGlobal: true } } } },
        },
      });
      const linhas = propostas
        .map((p): LinhaConsolidado => {
          const ultima = p.versoes[0];
          const oficial = p.versoes.find((v) => v.snapshot !== null);
          const orcado = oficial?.snapshot ? Dinheiro.de(oficial.snapshot.valorGlobal.toString()) : null;
          const realizado = Dinheiro.zero();
          return {
            numero: p.unidade.codigo,
            objeto: p.objeto,
            tipo: ROTULO_TIPO_PROPOSTA[p.tipo as TipoProposta],
            situacao: (ultima?.situacao ?? 'RASCUNHO') as SituacaoProposta,
            versaoAtual: ultima?.numero ?? 0,
            versaoOficial: oficial?.numero ?? null,
            orcado,
            realizado,
            percentual: orcado ? Percentual.razao(realizado, orcado) : null,
          };
        })
        .sort((a, b) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));
      const totalOrcado = Dinheiro.somarTodos(linhas.flatMap((l) => (l.orcado ? [l.orcado] : [])));
      const totalRealizado = Dinheiro.somarTodos(linhas.map((l) => l.realizado));
      return { linhas, totalOrcado, totalRealizado, percentual: Percentual.razao(totalRealizado, totalOrcado), oficializados: linhas.filter((l) => l.orcado).length };
    },
    { cliente: deps.cliente },
  );
}
