import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import type { NoCentroCusto } from '@/modules/cad/servidor';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import type { TxCliente } from '@/shared/db';
import { ConflitoConcorrencia, Dinheiro, exigirUmaLinha, falha, ok, type Resultado } from '@/shared/kernel';
import { aplicarUnidades, emUnidade } from '@/shared/unidade';
import { MENSAGENS_ORC as M } from '../domain/mensagens';
import {
  nomeDaUnidade,
  objetoDaCopia,
  RAIZ_CC_TP,
  SITUACOES_VERSIONAVEIS,
  validarCapa,
  type CapaValidada,
  type CategoriaProposta,
  type SituacaoProposta,
  type TipoProposta,
} from '../domain/proposta';
import { contextoAuditoria } from './calculo-linhas';
import { resolverDeps, type DepsOrc } from './deps';
import { copiarPessoalDaVersao } from './empregados';
import { copiarMetasDaVersao } from './metas';
import { copiarViagensDaVersao } from './viagens';
import { copiarBensDaVersao } from './bens';
import { CAMPOS_ORIGEM_BLINDADA, recusarCamposBlindados } from './governanca';

// Proposta de TP: capa, Versão 1 e CC próprio (US-065, UC 3.04, 3.05 e 3.07; plano do P17, Task 1).
// O TP é a unidade (§6.7, C31): a criação grava, numa transação, a unidade (código = número do TP,
// cc = CC do TP), o vínculo do criador, a capa, a Versão 1 em Rascunho e o Histórico (D-P17-2, D-P17-3).
// A capa e a versão têm RLS: depois de criar a unidade, o app.unidades da transação é refeito com ela.
// O CC é lido do C1 (sem gravar nada da frente B); a unicidade é do índice unidade_cc_ativa_key (D-P17-7).
// Duplicar e nova versão (US-066, UC03.08 e UC03.09; plano do P18, Task 1): duplicar é uma criação com os
// campos da origem pré-preenchidos (gravarPropostaNova, comum às duas); a nova versão é a revisão seguinte
// da mesma proposta. Toda operação sobre as versões começa subindo a versão da capa (updateMany condicional
// e exigirUmaLinha): a linha da capa fica travada até o commit, e a concorrente cai em ALTERADO_POR_OUTRO.

const FUNCIONALIDADE = 'orc.propostas';
// O vínculo do criador vai também ao Histórico do usuário, como na tela de usuários (US-031).
const FUNCIONALIDADE_USUARIOS = 'adm.usuarios';

export type PropostaTela = {
  id: string;
  numero: string;
  tipo: TipoProposta;
  objeto: string;
  parceiro: string | null;
  /** AAAA-MM-DD. */
  inicio: string;
  fim: string;
  categoria: CategoriaProposta;
  cc: string | null;
  situacao: SituacaoProposta;
  versaoAtual: number;
  /** Todas as versões em Rascunho: a exclusão (da proposta inteira) só vale assim (UC 3.07 E2). */
  excluivel: boolean;
  /** Sempre calculado (§6.2, RN_TP_003): zero até existirem lançamentos (R4 seguinte). */
  valorGlobal: Dinheiro;
  /** Versão de concorrência da capa (para a exclusão). */
  versao: number;
};

export type CcLivreTp = { classificacao: string; descricao: string };

const dia = (d: Date) => d.toISOString().slice(0, 10);
const data = (v: string) => new Date(`${v}T00:00:00.000Z`);

// O que vai ao Histórico (INSERCAO e EXCLUSAO): a capa como o usuário a vê.
const retrato = (c: Omit<CapaValidada, 'cc'> & { cc: string | null }, versaoAtual: number, situacao: SituacaoProposta) => ({
  numero: c.numero,
  tipo: c.tipo,
  objeto: c.objeto,
  parceiro: c.parceiro,
  inicio: c.inicio,
  fim: c.fim,
  categoria: c.categoria,
  cc: c.cc,
  versaoAtual,
  situacao,
});

// Campos do formulário (D-P17-4). O Valor Global e a situação são da ORIGEM BLINDADA (recusados antes).
const entradaCriar = z
  .object({
    tipo: z.string(),
    numero: z.string(),
    objeto: z.string(),
    parceiro: z.string(),
    inicio: z.string(),
    fim: z.string(),
    categoria: z.string(),
    cc: z.string(),
  })
  .partial()
  .strict();

const entradaExcluir = z.object({ id: z.string(), versao: z.coerce.number().int().min(0) }).strict();
const entradaNovaVersao = entradaExcluir;
// Duplicar (D-P18-3): número e CC novos; os demais campos, se ausentes, vêm da origem.
const entradaDuplicar = entradaCriar.extend({ origemId: z.string(), versaoOrigem: z.coerce.number().int().min(0) }).required({ origemId: true, versaoOrigem: true });
const uuid = z.uuid();

// O C1 inteiro (deps.estruturaCompleta): o deps.estrutura do orc vê só a raiz 4 da Adm. Central (C37), e os
// CCs de TP ficam fora dela.
const estruturaInteira = (deps: DepsOrc): DepsOrc['estrutura'] => deps.estruturaCompleta;

/** CCs analíticos ativos sob a raiz de TPs no C1 (D-P17-7). */
async function ccsDeTp(deps: DepsOrc): Promise<readonly string[]> {
  return (await estruturaInteira(deps).carregarIndiceEstrutura(deps.cliente)).centrosCustoAnaliticosSob(RAIZ_CC_TP);
}

function descricoes(nos: readonly NoCentroCusto[], mapa = new Map<string, string>()): Map<string, string> {
  for (const n of nos) {
    mapa.set(n.classificacao, n.descricao);
    descricoes(n.filhos, mapa);
  }
  return mapa;
}

/** Os CCs de TP livres para a nova proposta, na ordem do plano de CCs. Só para quem inclui proposta. */
export async function ccsLivresParaTp(ctx: ContextoRequisicao, depsParciais: Partial<DepsOrc> = {}): Promise<readonly CcLivreTp[]> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'incluir');
  const candidatos = await ccsDeTp(deps);
  if (candidatos.length === 0) return [];
  // A unidade é global e sem RLS: o CC de um TP de que o usuário não participa também conta como ocupado.
  const ocupados = new Set(
    (await deps.cliente.unidade.findMany({ where: { ativo: true, cc: { in: [...candidatos] } }, select: { cc: true } })).map((u) => u.cc),
  );
  const nomes = descricoes(await estruturaInteira(deps).listarArvoreCentrosCusto(deps.cliente));
  return candidatos.filter((cc) => !ocupados.has(cc)).map((cc) => ({ classificacao: cc, descricao: nomes.get(cc) ?? cc }));
}

// O número do TP é único sem diferença de maiúsculas (índice unidade_codigo_maiusculas_key): TP-001 e tp-001
// são o mesmo TP. A proposta excluída mantém o número ocupado (D-P17-10).
const numeroEmUso = async (c: Pick<TxCliente, 'unidade'>, numero: string) =>
  (await c.unidade.findFirst({ where: { codigo: { equals: numero, mode: 'insensitive' } }, select: { id: true } })) !== null;

const numeroDuplicado = (numero: string) => falha([{ campo: 'numero', mensagem: M.NUMERO_DUPLICADO(numero) }]);
const ccDeOutroTp = (cc: string) => falha([{ campo: 'cc', mensagem: M.CC_DE_OUTRO_TP(cc) }]);

// Unicidade violada na gravação (corrida entre duas criações): P2002 pelo Prisma ou 23505 no texto.
const violouUnicidade = (e: unknown) =>
  (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') || (e instanceof Error && /\b23505\b/.test(e.message));

type PropostaNova = { id: string; unidadeId: string; numero: string };
/** De onde vem a proposta duplicada (D-P18-5): vai ao Histórico e à cópia das linhas. */
type OrigemDuplicacao = { propostaId: string; numero: string; versaoId: string };

/**
 * Miolo transacional da criação, comum à criação (UC 3.05) e à duplicação (UC03.08): confere a unicidade do
 * número e do CC (RN_TP_001) e grava a unidade, o vínculo do criador, a capa, a Versão 1 em Rascunho e o
 * Histórico. Recusa só antes de gravar; depois de gravar, erro é exceção (a transação desfaz tudo).
 */
async function gravarPropostaNova(
  tx: TxCliente,
  ctx: ContextoRequisicao,
  capa: CapaValidada,
  deps: DepsOrc,
  origem?: OrigemDuplicacao,
): Promise<Resultado<PropostaNova>> {
  // Conferência antes de gravar, para a mensagem certa sem depender do erro do índice.
  if (await numeroEmUso(tx, capa.numero)) return numeroDuplicado(capa.numero);
  if (await tx.unidade.findFirst({ where: { cc: capa.cc, ativo: true }, select: { id: true } })) return ccDeOutroTp(capa.cc);

  const unidade = await tx.unidade.create({ data: { codigo: capa.numero, nome: nomeDaUnidade(capa.objeto), cc: capa.cc } });
  await tx.usuarioUnidade.create({ data: { usuarioId: ctx.usuarioId, unidadeId: unidade.id } });
  // O vínculo muda o usuário: a versão dele sobe, para a ficha aberta antes na tela de usuários (US-031)
  // não apagar o vínculo ao salvar (ela recusa a versão antiga com "alterado por outro").
  await tx.usuario.updateMany({ where: { id: ctx.usuarioId }, data: { versao: { increment: 1 }, atualizadoEm: deps.agora() } });
  // A RLS da capa e da versão exige a unidade nova no app.unidades desta transação (as do usuário ficam).
  await aplicarUnidades(tx, { ...ctx, unidades: [...(ctx.unidades ?? []), unidade.id] });
  const proposta = await tx.propostaTp.create({
    data: {
      unidadeId: unidade.id,
      tipo: capa.tipo,
      objeto: capa.objeto,
      parceiro: capa.parceiro,
      inicio: data(capa.inicio),
      fim: data(capa.fim),
      categoria: capa.categoria,
      criadoPor: ctx.usuarioId,
    },
    select: { id: true },
  });
  const v1 = await tx.versaoProposta.create({
    data: { unidadeId: unidade.id, propostaId: proposta.id, numero: 1, situacao: 'RASCUNHO', criadoPor: ctx.usuarioId },
    select: { id: true },
  });
  if (origem) await copiarLinhasDaVersao(tx, { propostaId: origem.propostaId, versaoId: origem.versaoId }, { propostaId: proposta.id, versaoId: v1.id }, ctx.usuarioId);

  const contexto = { ...contextoAuditoria(ctx), unidadeId: unidade.id };
  await auditar(tx, {
    contexto,
    funcionalidade: FUNCIONALIDADE,
    tipo: 'INSERCAO',
    registroId: proposta.id,
    descricao: origem
      ? `Proposta do TP ${capa.numero} duplicada da proposta do TP ${origem.numero}`
      : `Proposta do TP ${capa.numero} criada em Rascunho, com o CC ${capa.cc}`,
    depois: origem ? { ...retrato(capa, 1, 'RASCUNHO'), propostaOrigemId: origem.propostaId, numeroOrigem: origem.numero } : retrato(capa, 1, 'RASCUNHO'),
  });
  // Como na tela de usuários (US-031): o evento do usuário não é de uma unidade, e a unidade vai no depois.
  await auditar(tx, {
    contexto: { ...contexto, unidadeId: null },
    funcionalidade: FUNCIONALIDADE_USUARIOS,
    tipo: 'INSERCAO',
    registroId: ctx.usuarioId,
    descricao: `Unidade ${capa.numero} associada ao usuário ${ctx.usuarioRotulo}, que ${origem ? 'duplicou' : 'criou'} a proposta do TP`,
    depois: { unidadeId: unidade.id, numero: capa.numero },
  });
  return ok({ id: proposta.id, unidadeId: unidade.id, numero: capa.numero });
}

/** Na corrida, o índice único decide: quem perde recebe a mensagem do número ou do CC, sem nada gravado. */
async function decidirCorrida<T>(deps: DepsOrc, capa: CapaValidada, gravar: () => Promise<Resultado<T>>): Promise<Resultado<T>> {
  try {
    return await gravar();
  } catch (erro) {
    if (!violouUnicidade(erro)) throw erro;
    // A transação perdeu a corrida: quem ganhou já gravou; a leitura de agora diz qual índice foi.
    if (await numeroEmUso(deps.cliente, capa.numero)) return numeroDuplicado(capa.numero);
    if (await deps.cliente.unidade.findFirst({ where: { cc: capa.cc, ativo: true }, select: { id: true } })) return ccDeOutroTp(capa.cc);
    throw erro;
  }
}

/**
 * UC 3.05: cria a proposta. Valida a capa (domínio), o CC contra o C1 e a unicidade do número e do CC
 * (RN_TP_001). Na corrida, o índice único decide: quem perde recebe a mensagem, sem nada gravado.
 */
export async function criarProposta(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<PropostaNova>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'incluir');
  await recusarCamposBlindados(ctx, FUNCIONALIDADE, bruto, CAMPOS_ORIGEM_BLINDADA.proposta, deps);
  const parse = entradaCriar.safeParse(bruto);
  if (!parse.success) return falha([{ campo: '_', mensagem: M.PROPOSTA_DADOS_INVALIDOS }]);
  const v = validarCapa(parse.data);
  if (!v.ok) return v;
  const capa = v.valor;
  if (!(await ccsDeTp(deps)).includes(capa.cc)) return falha([{ campo: 'cc', mensagem: M.CC_INVALIDO_TP(capa.cc) }]);
  return decidirCorrida(deps, capa, () => deps.cliente.$transaction((tx) => gravarPropostaNova(tx, ctx, capa, deps)));
}

/**
 * Ponto de extensão (plano do P18): copia as linhas de uma versão para outra, na transação de quem chama
 * (duplicar: última versão da origem → V1 da nova; nova versão: anterior → seguinte). Copia as metas (US-067,
 * RN_DUP_003; plano do P19); cada história de lançamento (US-070 a 072) acrescenta aqui a cópia das suas, com
 * os testes da RN_DUP_003, 007 e 008.
 *
 * Regra para essas histórias (revisão 12.12 do #445): toda edição de linha sobe a `versao` da capa. A
 * duplicação confere essa versão no fim e não trava a origem; sem a regra, copiaria um conjunto misturado
 * de linhas lidas em comandos separados (ou ela passa a ler a origem com FOR SHARE).
 */
export async function copiarLinhasDaVersao(
  tx: TxCliente,
  origem: { propostaId: string; versaoId: string },
  destino: { propostaId: string; versaoId: string },
  criadoPor: string,
): Promise<void> {
  await copiarMetasDaVersao(tx, origem.versaoId, destino.versaoId, criadoPor);
  // Depois das metas: o pessoal aponta para a meta de destino de mesmo número (D-P20-8).
  await copiarPessoalDaVersao(tx, origem.versaoId, destino.versaoId, criadoPor);
  await copiarViagensDaVersao(tx, origem.versaoId, destino.versaoId, criadoPor);
  await copiarBensDaVersao(tx, origem.versaoId, destino.versaoId, criadoPor);
}

const ultimaVersao = { orderBy: { numero: 'desc' }, take: 1, select: { id: true, numero: true, situacao: true } } as const;

/** Os valores do modal de duplicar (D-P18-3): os campos da origem, com "Cópia de " no objeto. */
export type DadosDuplicar = {
  origemId: string;
  versaoOrigem: number;
  numeroOrigem: string;
  tipo: TipoProposta;
  objeto: string;
  parceiro: string | null;
  inicio: string;
  fim: string;
  categoria: CategoriaProposta;
};

/** Os valores do modal de duplicar; nulo se o usuário não vê a proposta (RLS) ou ela foi excluída. */
export async function dadosParaDuplicar(ctx: ContextoRequisicao, id: string, depsParciais: Partial<DepsOrc> = {}): Promise<DadosDuplicar | null> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'incluir');
  if (!uuid.safeParse(id).success) return null;
  const p = await emUnidade(ctx, (tx) => tx.propostaTp.findFirst({ where: { id, excluidaEm: null }, include: { unidade: { select: { codigo: true } } } }), {
    cliente: deps.cliente,
  });
  if (!p) return null;
  return {
    origemId: p.id,
    versaoOrigem: p.versao,
    numeroOrigem: p.unidade.codigo,
    tipo: p.tipo as TipoProposta,
    objeto: objetoDaCopia(p.objeto),
    parceiro: p.parceiro,
    inicio: dia(p.inicio),
    fim: dia(p.fim),
    categoria: p.categoria as CategoriaProposta,
  };
}

/**
 * UC03.08: duplica a proposta numa proposta nova e independente (TP novo, com unidade, número e CC próprios,
 * em Rascunho, Versão 1). A origem pode estar em qualquer situação (RN_DUP_001) e não muda; a excluída ou de
 * outra unidade é inexistente (D-P18-7). A versão da capa de origem é conferida no início e no fim, sem subir
 * (D-P18-8): origem mudada no meio desfaz tudo, com ALTERADO_POR_OUTRO.
 */
export async function duplicarProposta(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<PropostaNova>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'incluir');
  await recusarCamposBlindados(ctx, FUNCIONALIDADE, bruto, CAMPOS_ORIGEM_BLINDADA.proposta, deps);
  const parse = entradaDuplicar.safeParse(bruto);
  if (!parse.success) return falha([{ campo: '_', mensagem: M.PROPOSTA_DADOS_INVALIDOS }]);
  const { origemId, versaoOrigem, ...campos } = parse.data;
  const inexistente = falha([{ campo: '_', mensagem: M.PROPOSTA_INEXISTENTE }]);
  const alterado = falha([{ campo: '_', mensagem: M.ALTERADO_POR_OUTRO }]);

  const origem = await dadosParaDuplicar(ctx, origemId, deps);
  if (!origem) return inexistente;
  if (origem.versaoOrigem !== versaoOrigem) return alterado;
  const v = validarCapa({
    tipo: campos.tipo ?? origem.tipo,
    numero: campos.numero,
    objeto: campos.objeto ?? origem.objeto,
    parceiro: campos.parceiro ?? origem.parceiro ?? '',
    inicio: campos.inicio ?? origem.inicio,
    fim: campos.fim ?? origem.fim,
    categoria: campos.categoria ?? origem.categoria,
    cc: campos.cc,
  });
  if (!v.ok) return v;
  const capa = v.valor;
  if (!(await ccsDeTp(deps)).includes(capa.cc)) return falha([{ campo: 'cc', mensagem: M.CC_INVALIDO_TP(capa.cc) }]);

  try {
    return await decidirCorrida(deps, capa, () =>
      deps.cliente.$transaction(async (tx) => {
        await aplicarUnidades(tx, ctx);
        const o = await tx.propostaTp.findFirst({ where: { id: origemId, excluidaEm: null, versao: versaoOrigem }, select: { versoes: ultimaVersao } });
        const versaoDaOrigem = o?.versoes[0];
        if (!versaoDaOrigem) throw new ConflitoConcorrencia();
        const r = await gravarPropostaNova(tx, ctx, capa, deps, { propostaId: origemId, numero: origem.numeroOrigem, versaoId: versaoDaOrigem.id });
        if (!r.ok) return r;
        // RNF_DUP_REQ_003: a origem precisa estar como estava; se mudou no meio, nada fica gravado.
        if ((await tx.propostaTp.count({ where: { id: origemId, excluidaEm: null, versao: versaoOrigem } })) !== 1) throw new ConflitoConcorrencia();
        return r;
      }),
    );
  } catch (erro) {
    if (erro instanceof ConflitoConcorrencia) return alterado;
    throw erro;
  }
}

/**
 * UC03.09: cria a versão seguinte da mesma proposta, em Rascunho (D-P18-1) [PROVISÓRIO até o UC03.09 ser
 * reescrito, C16]. Só da última versão, em Rascunho ou Em Elaboração; a anterior fica como estava, só leitura
 * (D-P18-2). Começa subindo a versão da capa: a capa fica travada até o commit, e a exclusão ou outra nova
 * versão concorrente cai em ALTERADO_POR_OUTRO (D-P18-8).
 */
export async function novaVersaoProposta(
  ctx: ContextoRequisicao,
  bruto: unknown,
  depsParciais: Partial<DepsOrc> = {},
): Promise<Resultado<{ numero: string; versao: number }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'incluir');
  const parse = entradaNovaVersao.safeParse(bruto);
  if (!parse.success) return falha([{ campo: '_', mensagem: M.PROPOSTA_DADOS_INVALIDOS }]);
  const { id, versao } = parse.data;
  const inexistente = falha([{ campo: '_', mensagem: M.PROPOSTA_INEXISTENTE }]);
  if (!uuid.safeParse(id).success) return inexistente;
  try {
    return await emUnidade(
      ctx,
      async (tx) => {
        const p = await tx.propostaTp.findFirst({ where: { id, excluidaEm: null }, include: { unidade: { select: { codigo: true } }, versoes: ultimaVersao } });
        if (!p) return inexistente;
        if (p.versao !== versao) return falha([{ campo: '_', mensagem: M.ALTERADO_POR_OUTRO }]);
        const anterior = p.versoes[0];
        if (!anterior || !(SITUACOES_VERSIONAVEIS as readonly string[]).includes(anterior.situacao)) return falha([{ campo: '_', mensagem: M.VERSAO_NAO_PERMITIDA }]);

        // A trava: daqui ao commit, nenhuma outra operação sobre as versões desta proposta passa.
        exigirUmaLinha(await tx.propostaTp.updateMany({ where: { id, versao, excluidaEm: null }, data: { versao: { increment: 1 } } }));
        // Com a capa travada, a última versão lida antes precisa ser a mesma (situação mudada no meio: conflito).
        const agora = await tx.versaoProposta.findFirst({ where: { propostaId: id }, ...ultimaVersao });
        if (agora?.id !== anterior.id || agora.situacao !== anterior.situacao) throw new ConflitoConcorrencia();

        const n = anterior.numero + 1;
        const nova = await tx.versaoProposta.create({
          data: { unidadeId: p.unidadeId, propostaId: id, numero: n, situacao: 'RASCUNHO', criadoPor: ctx.usuarioId },
          select: { id: true },
        });
        await copiarLinhasDaVersao(tx, { propostaId: id, versaoId: anterior.id }, { propostaId: id, versaoId: nova.id }, ctx.usuarioId);
        await auditar(tx, {
          contexto: { ...contextoAuditoria(ctx), unidadeId: p.unidadeId },
          funcionalidade: FUNCIONALIDADE,
          tipo: 'INSERCAO',
          registroId: id,
          descricao: `Versão ${n} da proposta do TP ${p.unidade.codigo} criada em Rascunho`,
          depois: { versao: n, situacao: 'RASCUNHO', versaoAnterior: anterior.numero },
        });
        return ok({ numero: p.unidade.codigo, versao: n });
      },
      { cliente: deps.cliente },
    );
  } catch (erro) {
    // O índice (proposta_id, numero) é a segunda barreira, atrás da trava da capa: violado, também é
    // concorrência (revisão 12.12 do #445).
    if (erro instanceof ConflitoConcorrencia || violouUnicidade(erro)) return falha([{ campo: '_', mensagem: M.ALTERADO_POR_OUTRO }]);
    throw erro;
  }
}

/** UC 3.04: as propostas dos TPs do usuário (RLS), sem as excluídas, pela ordem do número. */
const todasEmRascunho = (versoes: readonly { situacao: string }[]) => versoes.length > 0 && versoes.every((v) => v.situacao === 'RASCUNHO');

export async function listarPropostas(ctx: ContextoRequisicao, depsParciais: Partial<DepsOrc> = {}): Promise<readonly PropostaTela[]> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const linhas = await emUnidade(
    ctx,
    (tx) =>
      tx.propostaTp.findMany({
        where: { excluidaEm: null },
        include: { unidade: { select: { codigo: true, cc: true } }, versoes: { orderBy: { numero: 'desc' }, select: { numero: true, situacao: true } } },
      }),
    { cliente: deps.cliente },
  );
  return linhas
    .map(
      (p): PropostaTela => ({
        id: p.id,
        numero: p.unidade.codigo,
        tipo: p.tipo as TipoProposta,
        objeto: p.objeto,
        parceiro: p.parceiro,
        inicio: dia(p.inicio),
        fim: dia(p.fim),
        categoria: p.categoria as CategoriaProposta,
        cc: p.unidade.cc,
        situacao: (p.versoes[0]?.situacao ?? 'RASCUNHO') as SituacaoProposta,
        versaoAtual: p.versoes[0]?.numero ?? 1,
        excluivel: todasEmRascunho(p.versoes),
        valorGlobal: Dinheiro.zero(),
        versao: p.versao,
      }),
    )
    .sort((a, b) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));
}

/**
 * UC 3.07: exclusão lógica da proposta em Rascunho (D-P17-8, D-P17-10). A capa fica marcada como
 * excluída, a unidade é inativada (libera o CC; o número continua ocupado) e os vínculos ficam.
 * Proposta de TP sem vínculo com o usuário: a RLS a esconde, e a resposta é a de inexistente.
 */
export async function excluirProposta(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ numero: string }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'excluir');
  const parse = entradaExcluir.safeParse(bruto);
  if (!parse.success) return falha([{ campo: '_', mensagem: M.PROPOSTA_DADOS_INVALIDOS }]);
  const { id, versao } = parse.data;
  const inexistente = falha([{ campo: '_', mensagem: M.PROPOSTA_INEXISTENTE }]);
  if (!uuid.safeParse(id).success) return inexistente;
  try {
    return await emUnidade(
      ctx,
      async (tx) => {
        const p = await tx.propostaTp.findFirst({
          where: { id, excluidaEm: null },
          include: { unidade: { select: { codigo: true, cc: true } }, versoes: { orderBy: { numero: 'desc' }, select: { numero: true, situacao: true } } },
        });
        if (!p) return inexistente;
        if (p.versao !== versao) return falha([{ campo: '_', mensagem: M.ALTERADO_POR_OUTRO }]);
        // A exclusão leva a proposta inteira (todas as versões): só com todas em Rascunho. Sem isso, uma V2
        // em Rascunho abriria caminho para excluir uma V1 Em Elaboração (revisão 12.12 do #445). A exclusão
        // de uma versão só é o UC03.11 (fora, D-P18-9).
        if (!todasEmRascunho(p.versoes)) return falha([{ campo: '_', mensagem: M.PROPOSTA_NAO_EXCLUIVEL }]);

        exigirUmaLinha(
          await tx.propostaTp.updateMany({
            where: { id, versao, excluidaEm: null },
            data: { excluidaEm: deps.agora(), excluidaPor: ctx.usuarioId, versao: { increment: 1 } },
          }),
        );
        exigirUmaLinha(await tx.unidade.updateMany({ where: { id: p.unidadeId, ativo: true }, data: { ativo: false } }));
        const capa = {
          numero: p.unidade.codigo,
          tipo: p.tipo as TipoProposta,
          objeto: p.objeto,
          parceiro: p.parceiro,
          inicio: dia(p.inicio),
          fim: dia(p.fim),
          categoria: p.categoria as CategoriaProposta,
          cc: p.unidade.cc,
        };
        await auditar(tx, {
          contexto: { ...contextoAuditoria(ctx), unidadeId: p.unidadeId },
          funcionalidade: FUNCIONALIDADE,
          tipo: 'EXCLUSAO',
          registroId: p.id,
          descricao: `Proposta do TP ${capa.numero} excluída`,
          antes: retrato(capa, p.versoes[0]!.numero, 'RASCUNHO'),
        });
        return ok({ numero: capa.numero });
      },
      { cliente: deps.cliente },
    );
  } catch (erro) {
    if (erro instanceof ConflitoConcorrencia) return falha([{ campo: '_', mensagem: M.ALTERADO_POR_OUTRO }]);
    throw erro;
  }
}
