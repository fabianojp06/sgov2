import { z } from 'zod';
import type { PremissasExercicio } from '@/modules/cad/servidor';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import type { TxCliente } from '@/shared/db';
import { Dinheiro, exigirUmaLinha, falha, ok, type Resultado } from '@/shared/kernel';
import { emUnidade } from '@/shared/unidade';
import {
  A_CONTRATAR,
  CATEGORIAS_EMPREGADO,
  competenciaDe,
  competenciaParaTexto,
  mesesDoAno,
  validarEmpregado,
  type CategoriaEmpregado,
  type Competencias,
  type EmpregadoValidado,
} from '../domain/empregado';
import { MENSAGENS_ORC as M } from '../domain/mensagens';
import { contextoAuditoria } from './calculo-linhas';
import { carregarCargos, custoDaPosicao, type CacheCargos } from './custo-posicao';
import { resolverDeps, type DepsOrc } from './deps';
import { CAMPOS_ORIGEM_BLINDADA, recusarCamposBlindados } from './governanca';
import {
  cabecalho,
  contem,
  executarPessoal,
  lerVersaoEditavel,
  metasDaVersao,
  resolverMeta,
  tipoDoFiltro,
  travarVersao,
  uuid,
  violouVinculo,
  type CabecalhoBloco,
  type FiltrosPessoal,
  type VersaoLida,
} from './pessoal-comum';
import { salarioFonteAtiva, validarCargoEscolhido } from './posicoes';

// Empregados (headcount) da proposta de TP (US-070, UC03.24 a UC03.27; plano do P20, Task 1). O empregado é
// da versão (D-P20-2), na meta (categoria Meta) ou sem ela (Consolidada). O cargo é do cadastro de C&S, e o
// salário é a Fonte Ativa decifrada herdada ao salvar (RN_EMP_007, REQ_EMP_004): trocar o cargo herda de novo;
// manter, guarda o gravado. O custo é do motor único (C33), ano a ano da competência (D-P20-4), e só vai a
// quem inclui ou altera (D-P20-5, D-P12-3). O envio do lote ao WA05 é da US-080 (D-P20-1).

const FUNCIONALIDADE = 'orc.empregados';

export type TotaisCategoria = Readonly<Record<CategoriaEmpregado, number>>;

export type EmpregadoTela = {
  id: string;
  metaId: string | null;
  ordem: number;
  categoria: CategoriaEmpregado;
  /** Nulo: vaga "A CONTRATAR" (RN0249). */
  nome: string | null;
  cargoId: string;
  /** Código e nome do cargo no cadastro. */
  cargo: string;
  /** RN_EMP_008: o nó analítico da estrutura funcional ligado ao cargo (C2, #469); nulo se o cargo não tem. */
  vinculoFuncional: string | null;
  /** Competências em "AAAA-MM". */
  inicio: string;
  fim: string;
  dependentes: number;
  versao: number;
  /** Custo do primeiro mês da competência (REQ_EMP_002); nulo para quem só consulta ou sem parâmetros. */
  custoMensal: Dinheiro | null;
  /** Soma dos anos com parâmetros; nulo para quem só consulta. */
  custoPeriodo: Dinheiro | null;
  /** Anos sem parâmetros e recusas do motor (só para quem vê o custo). */
  avisos: readonly string[];
};

export type GrupoEmpregados = { metaId: string | null; metaNumero: string | null; metaNome: string | null; empregados: readonly EmpregadoTela[]; totais: TotaisCategoria };

export type BlocoEmpregados = CabecalhoBloco & {
  /** Por meta na categoria Meta (RN0148); um grupo só, sem meta, na Consolidada. */
  grupos: readonly GrupoEmpregados[];
  /** Total geral por categoria (RN0147). */
  totais: TotaisCategoria;
  /** Quem vê o custo (D-P20-5). */
  veCusto: boolean;
};

export type OpcaoCargoEmpregado = { id: string; codigo: string; nome: string };

const versao = z.coerce.number().int().min(0);
const texto = z.string().optional();
const entradaIncluir = z
  .object({ propostaId: z.string(), versaoCapa: versao, metaId: texto, categoria: texto, nome: texto, cargoId: texto, inicio: texto, fim: texto, dependentes: texto })
  .strict();
const entradaAlterar = z
  .object({ id: z.string(), versao, versaoCapa: versao, categoria: texto, nome: texto, cargoId: texto, inicio: texto, fim: texto, dependentes: texto })
  .strict();
const entradaExcluir = z.object({ id: z.string(), versao, versaoCapa: versao }).strict();

const dadosInvalidos = () => falha([{ campo: '_', mensagem: M.EMPREGADO_DADOS_INVALIDOS }]);
const inexistente = () => falha([{ campo: '_', mensagem: M.EMPREGADO_INEXISTENTE }]);
const veCusto = (ctx: ContextoRequisicao) => ctx.permissoes.has(`${FUNCIONALIDADE}:incluir`) || ctx.permissoes.has(`${FUNCIONALIDADE}:alterar`);
const zerados = (): Record<CategoriaEmpregado, number> => ({ EMPREGADO: 0, ESTAGIARIO: 0, JOVEM_APRENDIZ: 0 });
const nomeDaTela = (nome: string | null) => nome ?? A_CONTRATAR;
const rotuloCargo = (cache: CacheCargos, cargoId: string) => {
  const c = cache.porId.get(cargoId);
  return c ? `${c.codigo} – ${c.nome}` : M.CARGO_NAO_ENCONTRADO;
};

// O que vai ao Histórico: o empregado como o usuário o vê, sem o salário nem o custo (Review Focus 5).
const retrato = (
  e: { ordem: number; categoria: string; nome: string | null; cargoId: string; inicio: Date; fim: Date; dependentes: number },
  tp: string,
  versaoProposta: number,
  meta: string | null,
) => ({
  numeroTp: tp,
  versaoProposta,
  meta,
  ordem: e.ordem,
  categoria: e.categoria,
  nome: nomeDaTela(e.nome),
  cargoId: e.cargoId,
  inicio: competenciaParaTexto(e.inicio),
  fim: competenciaParaTexto(e.fim),
  dependentes: e.dependentes,
});

/**
 * Premissas e benefícios por ano, lidos uma vez por chamada (premissas nulas: o ano não tem parâmetros). Os
 * benefícios do cargo mudam de ano para ano, e o cache do custo-posicao é por cargo: um por ano, com os
 * mesmos cargos.
 */
type CacheAnos = { cargos: CacheCargos; porAno: Map<number, { premissas: PremissasExercicio | null; cache: CacheCargos }> };
const cacheAnos = (cargos: CacheCargos): CacheAnos => ({ cargos, porAno: new Map() });

type CustoEmpregado = { mensal: Dinheiro | null; periodo: Dinheiro; avisos: string[]; erros: string[] };

/**
 * D-P20-4: o motor (custoDaPosicao do P15, com o adicional e os benefícios do cargo) para cada ano da
 * competência, com uma pessoa e o salário gravado. Ano sem parâmetros fica sem custo, com aviso; recusa do
 * motor vai em `erros` (a gravação recusa; a lista mostra como aviso).
 */
async function custoDoEmpregado(
  tx: TxCliente,
  deps: DepsOrc,
  anos: CacheAnos,
  e: Competencias & { cargoId: string; salarioMensal: Dinheiro },
): Promise<CustoEmpregado> {
  const r: CustoEmpregado = { mensal: null, periodo: Dinheiro.zero(), avisos: [], erros: [] };
  for (let ano = e.inicio.getUTCFullYear(); ano <= e.fim.getUTCFullYear(); ano++) {
    let doAno = anos.porAno.get(ano);
    if (!doAno) {
      doAno = { premissas: await deps.custoPessoal.obterPremissasExercicio(tx, ano), cache: { porId: anos.cargos.porId, beneficios: new Map() } };
      anos.porAno.set(ano, doAno);
    }
    const p = doAno.premissas;
    if (!p) {
      r.avisos.push(M.EMPREGADO_SEM_PARAMETROS(ano));
      continue;
    }
    const meses = mesesDoAno(e, ano)!;
    const serie = await custoDaPosicao(tx, deps, doAno.cache, p, { quantidade: 1, salarioMensal: e.salarioMensal, cargoId: e.cargoId, ...meses });
    if (!serie.ok) {
      r.erros.push(...serie.erros.map((x) => `${ano}: ${x.mensagem}`));
      continue;
    }
    r.periodo = r.periodo.somar(serie.valor.total);
    if (ano === e.inicio.getUTCFullYear()) r.mensal = serie.valor.totalMes[meses.mesInicio - 1]!;
  }
  return r;
}

/**
 * UC03.24: os empregados da última versão das propostas do usuário (RLS), em blocos por proposta e grupos
 * por meta (RN0148), com os totais por categoria (RN0147, RN0194). Filtros como nas metas (REQ0024,
 * REQ0030): Tipo, Proposta (número ou objeto) e Meta (número ou nome).
 */
export async function listarEmpregados(ctx: ContextoRequisicao, filtros: FiltrosPessoal = {}, depsParciais: Partial<DepsOrc> = {}): Promise<readonly BlocoEmpregados[]> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const tipo = tipoDoFiltro(filtros.tipo);
  const comCusto = veCusto(ctx);
  return emUnidade(
    ctx,
    async (tx) => {
      const propostas = await tx.propostaTp.findMany({
        where: { excluidaEm: null, ...(tipo ? { tipo } : {}) },
        include: {
          unidade: { select: { codigo: true } },
          versoes: { orderBy: { numero: 'desc' }, take: 1, select: { id: true, numero: true, situacao: true, empregados: true } },
        },
      });
      const cache = await carregarCargos(tx, deps);
      const anos = cacheAnos(cache);
      const blocos: BlocoEmpregados[] = [];
      for (const p of propostas) {
        const v = p.versoes[0];
        if (!v || !contem(`${p.unidade.codigo} ${p.objeto}`, filtros.proposta)) continue;
        const metas = await metasDaVersao(tx, v.id);
        const grupos: GrupoEmpregados[] = [];
        const totais = zerados();
        // Um grupo por meta da versão com empregado (RN0148) e, por último, o dos sem meta (a Consolidada).
        const chaves: { metaId: string | null; metaNumero: string | null; metaNome: string | null }[] = [
          ...metas.todas.map((m) => ({ metaId: m.id, metaNumero: m.numero, metaNome: m.nome })),
          { metaId: null, metaNumero: null, metaNome: null },
        ];
        for (const chave of chaves) {
          if (filtros.meta?.trim() && (chave.metaId === null || !contem(`${chave.metaNumero} ${chave.metaNome}`, filtros.meta))) continue;
          const doGrupo = v.empregados.filter((e) => e.metaId === chave.metaId).sort((a, b) => a.ordem - b.ordem);
          if (doGrupo.length === 0) continue;
          const empregados: EmpregadoTela[] = [];
          const doTotal = zerados();
          for (const e of doGrupo) {
            const custo = comCusto ? await custoDoEmpregado(tx, deps, anos, { ...e, salarioMensal: Dinheiro.de(e.salarioMensal) }) : null;
            const categoria = e.categoria as CategoriaEmpregado;
            doTotal[categoria]++;
            empregados.push({
              id: e.id,
              metaId: e.metaId,
              ordem: e.ordem,
              categoria,
              nome: e.nome,
              cargoId: e.cargoId,
              cargo: rotuloCargo(cache, e.cargoId),
              vinculoFuncional: cache.porId.get(e.cargoId)?.vinculoFuncional?.nome ?? null,
              inicio: competenciaParaTexto(e.inicio),
              fim: competenciaParaTexto(e.fim),
              dependentes: e.dependentes,
              versao: e.versao,
              custoMensal: custo?.mensal ?? null,
              custoPeriodo: custo?.periodo ?? null,
              avisos: custo ? [...custo.avisos, ...custo.erros] : [],
            });
          }
          for (const c of CATEGORIAS_EMPREGADO) totais[c] += doTotal[c];
          grupos.push({ ...chave, empregados, totais: doTotal });
        }
        if (filtros.meta?.trim() && grupos.length === 0) continue;
        blocos.push({ ...cabecalho(p, v, metas.ativas), grupos, totais, veCusto: comCusto });
      }
      return blocos.sort((a, b) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));
    },
    { cliente: deps.cliente },
  );
}

/** Cargos do formulário (D-P20-5): os ativos com Fonte Ativa, por código e nome, sem salário. */
export async function cargosParaEmpregado(ctx: ContextoRequisicao, depsParciais: Partial<DepsOrc> = {}): Promise<readonly OpcaoCargoEmpregado[]> {
  if (!veCusto(ctx)) exigir(ctx, FUNCIONALIDADE, 'incluir');
  const deps = resolverDeps(depsParciais);
  const cargos = await deps.custoPessoal.listarCargosSemSalarioCifrado(deps.cliente);
  return cargos.filter((c) => c.ativo && c.fonteAtiva !== null).map((c) => ({ id: c.id, codigo: c.codigo, nome: c.nome }));
}

/** O empregado e a proposta dele; nulo se o usuário não o vê (RLS) ou o id não é válido. */
async function lerEmpregado(tx: TxCliente, id: string) {
  if (!uuid.safeParse(id).success) return null;
  return tx.empregadoProposta.findFirst({
    where: { id },
    include: { versaoProposta: { select: { propostaId: true } }, meta: { select: { numero: true } } },
  });
}

type Preparo = { cargoId: string; salario: Dinheiro };

/**
 * O cargo do cadastro (D-P15-2: inativo e sem Fonte Ativa só recusados na troca) e o salário: na troca, a
 * Fonte Ativa decifrada (sem a chave, recusa); mantido o cargo, o salário gravado. Depois, o motor nos anos
 * com parâmetros: recusa dele (insalubridade sem SMN, conta inativa) vira erro. Tudo antes da trava.
 */
async function prepararCargo(
  tx: TxCliente,
  deps: DepsOrc,
  e: EmpregadoValidado,
  gravado: { cargoId: string; salario: Dinheiro } | null,
): Promise<Resultado<Preparo>> {
  const cache = await carregarCargos(tx, deps);
  const cargo = await validarCargoEscolhido(tx, cache, e.cargoId, gravado?.cargoId ?? null, deps);
  if (!cargo.ok) return cargo;
  const salario = gravado && gravado.cargoId === e.cargoId ? gravado.salario : await salarioFonteAtiva(tx, e.cargoId, deps);
  if (!salario) return falha([{ campo: 'cargoId', mensagem: M.EMPREGADO_CARGO_SEM_SALARIO }]);
  const custo = await custoDoEmpregado(tx, deps, cacheAnos(cache), { ...e, salarioMensal: salario });
  if (custo.erros.length > 0) return falha(custo.erros.map((mensagem) => ({ campo: '_', mensagem })));
  return ok({ cargoId: e.cargoId, salario });
}

/** Valida contra a vigência da proposta lida (a validação do domínio precisa dela). */
const validarNaVersao = (lida: VersaoLida, campos: Readonly<Record<string, unknown>>): Resultado<EmpregadoValidado> => validarEmpregado(campos, lida.vigencia);

const dadosGravados = (e: EmpregadoValidado, salario: Dinheiro) => ({
  categoria: e.categoria,
  nome: e.nome,
  cargoId: e.cargoId,
  salarioMensal: salario.paraString(),
  inicio: e.inicio,
  fim: e.fim,
  dependentes: e.dependentes,
});

/** UC03.25: inclui o empregado (ou a vaga "A CONTRATAR") na última versão da proposta. */
export async function incluirEmpregado(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ ordem: number; nome: string }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'incluir');
  await recusarCamposBlindados(ctx, FUNCIONALIDADE, bruto, CAMPOS_ORIGEM_BLINDADA.empregado, deps);
  const parse = entradaIncluir.safeParse(bruto);
  if (!parse.success) return dadosInvalidos();
  const { propostaId, versaoCapa, metaId, ...campos } = parse.data;
  return executarPessoal(ctx, deps, async (tx) => {
    const lida = await lerVersaoEditavel(tx, propostaId, versaoCapa, M.EMPREGADO_VERSAO_IMUTAVEL);
    if (!lida.ok) return lida;
    const v = validarNaVersao(lida.valor, campos);
    if (!v.ok) return v;
    const meta = await resolverMeta(tx, lida.valor, metaId);
    if (!meta.ok) return meta;
    const preparo = await prepararCargo(tx, deps, v.valor, null);
    if (!preparo.ok) return preparo;
    await travarVersao(tx, lida.valor);

    const { unidadeId, numeroTp, versaoId, versaoNumero } = lida.valor;
    const metaIdGravada = meta.valor?.id ?? null;
    // RN0242: a próxima ordem da versão e da meta, com a capa travada.
    const ultima = await tx.empregadoProposta.aggregate({ where: { versaoPropostaId: versaoId, metaId: metaIdGravada }, _max: { ordem: true } });
    const ordem = (ultima._max.ordem ?? 0) + 1;
    const criado = await tx.empregadoProposta.create({
      data: { unidadeId, versaoPropostaId: versaoId, metaId: metaIdGravada, ordem, ...dadosGravados(v.valor, preparo.valor.salario), criadoPor: ctx.usuarioId },
      select: { id: true },
    });
    const nome = nomeDaTela(v.valor.nome);
    await auditar(tx, {
      contexto: { ...contextoAuditoria(ctx), unidadeId },
      funcionalidade: FUNCIONALIDADE,
      tipo: 'INSERCAO',
      registroId: criado.id,
      descricao: `Empregado ${ordem} (${nome}) incluído na versão ${versaoNumero} da proposta do TP ${numeroTp}`,
      depois: retrato({ ...v.valor, ordem }, numeroTp, versaoNumero, meta.valor?.numero ?? null),
    });
    return ok({ ordem, nome });
  });
}

/**
 * UC03.26: altera categoria, nome, cargo, competências e dependentes. A ordem, a meta e a versão são só
 * leitura (RN0242, RN0245). Só o empregado da última versão, editável.
 */
export async function alterarEmpregado(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ ordem: number; nome: string }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'alterar');
  await recusarCamposBlindados(ctx, FUNCIONALIDADE, bruto, [...CAMPOS_ORIGEM_BLINDADA.empregado, 'metaId'], deps);
  const parse = entradaAlterar.safeParse(bruto);
  if (!parse.success) return dadosInvalidos();
  const { id, versao: versaoEmpregado, versaoCapa, ...campos } = parse.data;
  return executarPessoal(ctx, deps, async (tx) => {
    const e = await lerEmpregado(tx, id);
    if (!e) return inexistente();
    const lida = await lerVersaoEditavel(tx, e.versaoProposta.propostaId, versaoCapa, M.EMPREGADO_VERSAO_IMUTAVEL, e.versaoPropostaId);
    if (!lida.ok) return lida;
    const v = validarNaVersao(lida.valor, campos);
    if (!v.ok) return v;
    const preparo = await prepararCargo(tx, deps, v.valor, { cargoId: e.cargoId, salario: Dinheiro.de(e.salarioMensal) });
    if (!preparo.ok) return preparo;
    if (e.versao !== versaoEmpregado) return falha([{ campo: '_', mensagem: M.ALTERADO_POR_OUTRO }]);
    await travarVersao(tx, lida.valor);

    const { unidadeId, numeroTp, versaoNumero } = lida.valor;
    exigirUmaLinha(
      await tx.empregadoProposta.updateMany({ where: { id, versao: versaoEmpregado }, data: { ...dadosGravados(v.valor, preparo.valor.salario), versao: { increment: 1 } } }),
    );
    const nome = nomeDaTela(v.valor.nome);
    const meta = e.meta?.numero ?? null;
    await auditar(tx, {
      contexto: { ...contextoAuditoria(ctx), unidadeId },
      funcionalidade: FUNCIONALIDADE,
      tipo: 'ALTERACAO',
      registroId: id,
      descricao: `Empregado ${e.ordem} (${nome}) alterado na versão ${versaoNumero} da proposta do TP ${numeroTp}`,
      antes: retrato(e, numeroTp, versaoNumero, meta),
      depois: retrato({ ...v.valor, ordem: e.ordem }, numeroTp, versaoNumero, meta),
    });
    return ok({ ordem: e.ordem, nome });
  });
}

/** UC03.27: exclusão física (D-P20-9). Com viagem ligada, a FK recusa (RN0254, E1). */
export async function excluirEmpregado(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ ordem: number; nome: string }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'excluir');
  const parse = entradaExcluir.safeParse(bruto);
  if (!parse.success) return dadosInvalidos();
  const { id, versao: versaoEmpregado, versaoCapa } = parse.data;
  try {
    return await executarPessoal(ctx, deps, async (tx) => {
      const e = await lerEmpregado(tx, id);
      if (!e) return inexistente();
      const lida = await lerVersaoEditavel(tx, e.versaoProposta.propostaId, versaoCapa, M.EMPREGADO_VERSAO_IMUTAVEL, e.versaoPropostaId);
      if (!lida.ok) return lida;
      if (e.versao !== versaoEmpregado) return falha([{ campo: '_', mensagem: M.ALTERADO_POR_OUTRO }]);
      await travarVersao(tx, lida.valor);

      const { unidadeId, numeroTp, versaoNumero } = lida.valor;
      exigirUmaLinha(await tx.empregadoProposta.deleteMany({ where: { id, versao: versaoEmpregado } }));
      const nome = nomeDaTela(e.nome);
      await auditar(tx, {
        contexto: { ...contextoAuditoria(ctx), unidadeId },
        funcionalidade: FUNCIONALIDADE,
        tipo: 'EXCLUSAO',
        registroId: id,
        descricao: `Empregado ${e.ordem} (${nome}) excluído da versão ${versaoNumero} da proposta do TP ${numeroTp}`,
        antes: retrato(e, numeroTp, versaoNumero, e.meta?.numero ?? null),
      });
      return ok({ ordem: e.ordem, nome });
    });
  } catch (erro) {
    if (violouVinculo(erro)) return falha([{ campo: '_', mensagem: M.EMPREGADO_EXCLUSAO_VINCULADA }]);
    throw erro;
  }
}

/**
 * RN_DUP_003 (D-P20-8): copia empregados e quantitativos de uma versão para outra, com ids novos, a mesma
 * ordem e a meta de destino de mesmo número. Chamada pelo copiarLinhasDaVersao depois das metas. A duplicação
 * pode mudar a capa (revisão 12.12 do #467): com outra categoria, o pessoal não vem (a meta seria incoerente,
 * RN0245); com outra vigência, só vem o que cabe nela (RN0252, RN0154).
 */
export async function copiarPessoalDaVersao(tx: TxCliente, origemVersaoId: string, destinoVersaoId: string, criadoPor: string): Promise<void> {
  const [empregados, qtdes] = await Promise.all([
    tx.empregadoProposta.findMany({ where: { versaoPropostaId: origemVersaoId }, include: { meta: { select: { numero: true } } } }),
    tx.qtdeEmpregadoProposta.findMany({ where: { versaoPropostaId: origemVersaoId }, include: { meta: { select: { numero: true } } } }),
  ]);
  if (empregados.length === 0 && qtdes.length === 0) return;
  const capa = { select: { categoria: true, inicio: true, fim: true } } as const;
  const origem = await tx.versaoProposta.findUniqueOrThrow({ where: { id: origemVersaoId }, select: { proposta: capa } });
  const destino = await tx.versaoProposta.findUniqueOrThrow({
    where: { id: destinoVersaoId },
    select: { unidadeId: true, proposta: capa, metas: { select: { id: true, numero: true } } },
  });
  if (origem.proposta.categoria !== destino.proposta.categoria) return;
  const vigencia = { inicio: competenciaDe(destino.proposta.inicio), fim: competenciaDe(destino.proposta.fim) };
  const cabe = (p: Competencias) => p.inicio >= vigencia.inicio && p.fim <= vigencia.fim;
  const metaDe = new Map(destino.metas.map((m) => [m.numero, m.id]));
  const metaNoDestino = (m: { numero: string } | null) => (m ? (metaDe.get(m.numero) ?? null) : null);
  const base = { unidadeId: destino.unidadeId, versaoPropostaId: destinoVersaoId, criadoPor };
  const empregadosQueCabem = empregados.filter(cabe);
  const qtdesQueCabem = qtdes.filter(cabe);
  if (empregadosQueCabem.length > 0) {
    await tx.empregadoProposta.createMany({
      data: empregadosQueCabem.map((e) => ({
        ...base,
        metaId: metaNoDestino(e.meta),
        ordem: e.ordem,
        categoria: e.categoria,
        nome: e.nome,
        cargoId: e.cargoId,
        salarioMensal: e.salarioMensal,
        inicio: e.inicio,
        fim: e.fim,
        dependentes: e.dependentes,
      })),
    });
  }
  if (qtdesQueCabem.length > 0) {
    await tx.qtdeEmpregadoProposta.createMany({
      data: qtdesQueCabem.map((q) => ({ ...base, metaId: metaNoDestino(q.meta), inicio: q.inicio, fim: q.fim, documento: q.documento })),
    });
  }
}
