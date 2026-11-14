import { z } from 'zod';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import type { TxCliente } from '@/shared/db';
import { exigirUmaLinha, falha, ok, type Resultado } from '@/shared/kernel';
import { emUnidade } from '@/shared/unidade';
import { competenciaParaTexto, cruza, validarQtde, type CategoriaEmpregado, type Competencias, type QtdeValidada } from '../domain/empregado';
import { MENSAGENS_ORC as M } from '../domain/mensagens';
import { contextoAuditoria } from './calculo-linhas';
import { resolverDeps, type DepsOrc } from './deps';
import type { TotaisCategoria } from './empregados';
import { CAMPOS_ORIGEM_BLINDADA, recusarCamposBlindados } from './governanca';
import {
  cabecalho,
  contem,
  executarPessoal,
  lerVersaoDoPessoal,
  metasDaVersao,
  resolverMeta,
  tipoDoFiltro,
  travarVersao,
  uuid,
  type CabecalhoBloco,
  type FiltrosPessoal,
} from './pessoal-comum';

// Quantitativos de pessoal por período da proposta de TP (US-070, UC03.20 a UC03.23; plano do P20, D-P20-6).
// Só o período e o número do documento são digitados (REQ0133); as quantidades de empregados, estagiários e
// jovens aprendizes são a contagem dos empregados da mesma versão e meta cuja competência cruza o período
// (RN0457), sempre na leitura. Períodos da mesma versão e meta não se sobrepõem (RN0155), conferido com a capa
// travada. Exclusão física (UC03.23); a trava de viagens (RN0145) chega com a US-071.

const FUNCIONALIDADE = 'orc.qtde_empregados';

export type QtdeTela = {
  id: string;
  metaId: string | null;
  documento: string;
  /** Competências em "AAAA-MM". */
  inicio: string;
  fim: string;
  quantidades: TotaisCategoria;
  versao: number;
};

export type GrupoQtdes = { metaId: string | null; metaNumero: string | null; metaNome: string | null; qtdes: readonly QtdeTela[]; totais: TotaisCategoria };

export type BlocoQtdes = CabecalhoBloco & {
  /** Por meta na categoria Meta (RN0146, RN0148); um grupo só na Consolidada. */
  grupos: readonly GrupoQtdes[];
  /** Total geral por categoria (RN0147). */
  totais: TotaisCategoria;
};

const versao = z.coerce.number().int().min(0);
const texto = z.string().optional();
const entradaIncluir = z.object({ propostaId: z.string(), versaoCapa: versao, metaId: texto, inicio: texto, fim: texto, documento: texto }).strict();
const entradaAlterar = z.object({ id: z.string(), versao, versaoCapa: versao, inicio: texto, fim: texto, documento: texto }).strict();
const entradaExcluir = z.object({ id: z.string(), versao, versaoCapa: versao }).strict();

const dadosInvalidos = () => falha([{ campo: '_', mensagem: M.QTDE_DADOS_INVALIDOS }]);
const inexistente = () => falha([{ campo: '_', mensagem: M.QTDE_INEXISTENTE }]);
const zerados = (): Record<CategoriaEmpregado, number> => ({ EMPREGADO: 0, ESTAGIARIO: 0, JOVEM_APRENDIZ: 0 });

/** RN0457: a contagem por categoria dos empregados cuja competência cruza o período. */
export function contarNoPeriodo(periodo: Competencias, empregados: readonly (Competencias & { categoria: string })[]): TotaisCategoria {
  const t = zerados();
  for (const e of empregados) if (cruza(periodo, e)) t[e.categoria as CategoriaEmpregado]++;
  return t;
}

const somar = (a: TotaisCategoria, b: TotaisCategoria): TotaisCategoria => ({
  EMPREGADO: a.EMPREGADO + b.EMPREGADO,
  ESTAGIARIO: a.ESTAGIARIO + b.ESTAGIARIO,
  JOVEM_APRENDIZ: a.JOVEM_APRENDIZ + b.JOVEM_APRENDIZ,
});

// O que vai ao Histórico: o registro como o usuário o vê, com as quantidades da hora (RN0232).
const retrato = (q: Competencias & { documento: string }, tp: string, versaoProposta: number, meta: string | null, quantidades: TotaisCategoria) => ({
  numeroTp: tp,
  versaoProposta,
  meta,
  documento: q.documento,
  inicio: competenciaParaTexto(q.inicio),
  fim: competenciaParaTexto(q.fim),
  ...quantidades,
});

/** UC03.20: os quantitativos da última versão das propostas do usuário (RLS), por proposta e meta. */
export async function listarQtdes(ctx: ContextoRequisicao, filtros: FiltrosPessoal = {}, depsParciais: Partial<DepsOrc> = {}): Promise<readonly BlocoQtdes[]> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const tipo = tipoDoFiltro(filtros.tipo);
  return emUnidade(
    ctx,
    async (tx) => {
      const propostas = await tx.propostaTp.findMany({
        where: { excluidaEm: null, ...(tipo ? { tipo } : {}) },
        include: {
          unidade: { select: { codigo: true } },
          versoes: {
            orderBy: { numero: 'desc' },
            take: 1,
            select: { id: true, numero: true, situacao: true, qtdes: true, empregados: { select: { metaId: true, categoria: true, inicio: true, fim: true } } },
          },
        },
      });
      const blocos: BlocoQtdes[] = [];
      for (const p of propostas) {
        const v = p.versoes[0];
        if (!v || !contem(`${p.unidade.codigo} ${p.objeto}`, filtros.proposta)) continue;
        const metas = await metasDaVersao(tx, v.id);
        const chaves: { metaId: string | null; metaNumero: string | null; metaNome: string | null }[] = [
          ...metas.todas.map((m) => ({ metaId: m.id, metaNumero: m.numero, metaNome: m.nome })),
          { metaId: null, metaNumero: null, metaNome: null },
        ];
        const grupos: GrupoQtdes[] = [];
        let totais: TotaisCategoria = zerados();
        for (const chave of chaves) {
          if (filtros.meta?.trim() && (chave.metaId === null || !contem(`${chave.metaNumero} ${chave.metaNome}`, filtros.meta))) continue;
          const doGrupo = v.qtdes.filter((q) => q.metaId === chave.metaId).sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
          if (doGrupo.length === 0) continue;
          const daMeta = v.empregados.filter((e) => e.metaId === chave.metaId);
          const qtdes = doGrupo.map(
            (q): QtdeTela => ({
              id: q.id,
              metaId: q.metaId,
              documento: q.documento,
              inicio: competenciaParaTexto(q.inicio),
              fim: competenciaParaTexto(q.fim),
              quantidades: contarNoPeriodo(q, daMeta),
              versao: q.versao,
            }),
          );
          // RN0194: o total da meta é a soma das linhas do grupo.
          const doTotal = qtdes.reduce((t, q) => somar(t, q.quantidades), zerados() as TotaisCategoria);
          totais = somar(totais, doTotal);
          grupos.push({ ...chave, qtdes, totais: doTotal });
        }
        if (filtros.meta?.trim() && grupos.length === 0) continue;
        blocos.push({ ...cabecalho(p, v, metas.ativas), grupos, totais });
      }
      return blocos.sort((a, b) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));
    },
    { cliente: deps.cliente },
  );
}

async function lerQtde(tx: TxCliente, id: string) {
  if (!uuid.safeParse(id).success) return null;
  return tx.qtdeEmpregadoProposta.findFirst({ where: { id }, include: { versaoProposta: { select: { propostaId: true } }, meta: { select: { numero: true } } } });
}

/** RN0155: outro período da mesma versão e meta que cruza este (o próprio registro fica de fora no alterar). */
async function sobreposto(tx: TxCliente, versaoId: string, metaId: string | null, q: QtdeValidada, exceto?: string): Promise<string | null> {
  const outros = await tx.qtdeEmpregadoProposta.findMany({ where: { versaoPropostaId: versaoId, metaId, ...(exceto ? { id: { not: exceto } } : {}) } });
  return outros.find((o) => cruza(o, q))?.documento ?? null;
}

const quantidadesDe = async (tx: TxCliente, versaoId: string, metaId: string | null, q: Competencias) =>
  contarNoPeriodo(q, await tx.empregadoProposta.findMany({ where: { versaoPropostaId: versaoId, metaId }, select: { categoria: true, inicio: true, fim: true } }));

/** UC03.21: inclui o período com o documento de respaldo na última versão da proposta. */
export async function incluirQtde(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ documento: string }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'incluir');
  await recusarCamposBlindados(ctx, FUNCIONALIDADE, bruto, CAMPOS_ORIGEM_BLINDADA.qtde, deps);
  const parse = entradaIncluir.safeParse(bruto);
  if (!parse.success) return dadosInvalidos();
  const { propostaId, versaoCapa, metaId, ...campos } = parse.data;
  return executarPessoal(ctx, deps, async (tx) => {
    const lida = await lerVersaoDoPessoal(tx, propostaId, versaoCapa, M.QTDE_VERSAO_IMUTAVEL);
    if (!lida.ok) return lida;
    const v = validarQtde(campos, lida.valor.vigencia);
    if (!v.ok) return v;
    const meta = await resolverMeta(tx, lida.valor, metaId);
    if (!meta.ok) return meta;
    const metaIdGravada = meta.valor?.id ?? null;
    const outro = await sobreposto(tx, lida.valor.versaoId, metaIdGravada, v.valor);
    if (outro !== null) return falha([{ campo: 'inicio', mensagem: M.QTDE_SOBREPOSTA(outro) }]);
    await travarVersao(tx, lida.valor);

    const { unidadeId, numeroTp, versaoId, versaoNumero } = lida.valor;
    const criada = await tx.qtdeEmpregadoProposta.create({
      data: { unidadeId, versaoPropostaId: versaoId, metaId: metaIdGravada, inicio: v.valor.inicio, fim: v.valor.fim, documento: v.valor.documento, criadoPor: ctx.usuarioId },
      select: { id: true },
    });
    await auditar(tx, {
      contexto: { ...contextoAuditoria(ctx), unidadeId },
      funcionalidade: FUNCIONALIDADE,
      tipo: 'INSERCAO',
      registroId: criada.id,
      descricao: `Quantitativo do documento ${v.valor.documento} incluído na versão ${versaoNumero} da proposta do TP ${numeroTp}`,
      depois: retrato(v.valor, numeroTp, versaoNumero, meta.valor?.numero ?? null, await quantidadesDe(tx, versaoId, metaIdGravada, v.valor)),
    });
    return ok({ documento: v.valor.documento });
  });
}

/** UC03.22: altera o período e o documento; a meta e as quantidades são só leitura (RN0457). */
export async function alterarQtde(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ documento: string }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'alterar');
  await recusarCamposBlindados(ctx, FUNCIONALIDADE, bruto, [...CAMPOS_ORIGEM_BLINDADA.qtde, 'metaId'], deps);
  const parse = entradaAlterar.safeParse(bruto);
  if (!parse.success) return dadosInvalidos();
  const { id, versao: versaoQtde, versaoCapa, ...campos } = parse.data;
  return executarPessoal(ctx, deps, async (tx) => {
    const q = await lerQtde(tx, id);
    if (!q) return inexistente();
    const lida = await lerVersaoDoPessoal(tx, q.versaoProposta.propostaId, versaoCapa, M.QTDE_VERSAO_IMUTAVEL, q.versaoPropostaId);
    if (!lida.ok) return lida;
    const v = validarQtde(campos, lida.valor.vigencia);
    if (!v.ok) return v;
    const outro = await sobreposto(tx, q.versaoPropostaId, q.metaId, v.valor, q.id);
    if (outro !== null) return falha([{ campo: 'inicio', mensagem: M.QTDE_SOBREPOSTA(outro) }]);
    if (q.versao !== versaoQtde) return falha([{ campo: '_', mensagem: M.ALTERADO_POR_OUTRO }]);
    await travarVersao(tx, lida.valor);

    const { unidadeId, numeroTp, versaoNumero } = lida.valor;
    exigirUmaLinha(
      await tx.qtdeEmpregadoProposta.updateMany({
        where: { id, versao: versaoQtde },
        data: { inicio: v.valor.inicio, fim: v.valor.fim, documento: v.valor.documento, versao: { increment: 1 } },
      }),
    );
    const meta = q.meta?.numero ?? null;
    await auditar(tx, {
      contexto: { ...contextoAuditoria(ctx), unidadeId },
      funcionalidade: FUNCIONALIDADE,
      tipo: 'ALTERACAO',
      registroId: id,
      descricao: `Quantitativo do documento ${v.valor.documento} alterado na versão ${versaoNumero} da proposta do TP ${numeroTp}`,
      antes: retrato(q, numeroTp, versaoNumero, meta, await quantidadesDe(tx, q.versaoPropostaId, q.metaId, q)),
      depois: retrato(v.valor, numeroTp, versaoNumero, meta, await quantidadesDe(tx, q.versaoPropostaId, q.metaId, v.valor)),
    });
    return ok({ documento: v.valor.documento });
  });
}

/** UC03.23: exclusão física, só com a versão editável (RN0159, E1). */
export async function excluirQtde(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ documento: string }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'excluir');
  const parse = entradaExcluir.safeParse(bruto);
  if (!parse.success) return dadosInvalidos();
  const { id, versao: versaoQtde, versaoCapa } = parse.data;
  return executarPessoal(ctx, deps, async (tx) => {
    const q = await lerQtde(tx, id);
    if (!q) return inexistente();
    const lida = await lerVersaoDoPessoal(tx, q.versaoProposta.propostaId, versaoCapa, M.QTDE_VERSAO_IMUTAVEL, q.versaoPropostaId);
    if (!lida.ok) return lida;
    if (q.versao !== versaoQtde) return falha([{ campo: '_', mensagem: M.ALTERADO_POR_OUTRO }]);
    await travarVersao(tx, lida.valor);

    const { unidadeId, numeroTp, versaoNumero } = lida.valor;
    exigirUmaLinha(await tx.qtdeEmpregadoProposta.deleteMany({ where: { id, versao: versaoQtde } }));
    await auditar(tx, {
      contexto: { ...contextoAuditoria(ctx), unidadeId },
      funcionalidade: FUNCIONALIDADE,
      tipo: 'EXCLUSAO',
      registroId: id,
      descricao: `Quantitativo do documento ${q.documento} excluído da versão ${versaoNumero} da proposta do TP ${numeroTp}`,
      antes: retrato(q, numeroTp, versaoNumero, q.meta?.numero ?? null, await quantidadesDe(tx, q.versaoPropostaId, q.metaId, q)),
    });
    return ok({ documento: q.documento });
  });
}

