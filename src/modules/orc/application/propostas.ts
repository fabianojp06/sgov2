import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import type { NoCentroCusto } from '@/modules/cad/servidor';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { ConflitoConcorrencia, Dinheiro, exigirUmaLinha, falha, ok, type Resultado } from '@/shared/kernel';
import { aplicarUnidades, emUnidade } from '@/shared/unidade';
import { MENSAGENS_ORC as M } from '../domain/mensagens';
import {
  nomeDaUnidade,
  RAIZ_CC_TP,
  validarCapa,
  type CapaValidada,
  type CategoriaProposta,
  type SituacaoProposta,
  type TipoProposta,
} from '../domain/proposta';
import { contextoAuditoria } from './calculo-linhas';
import { resolverDeps, type DepsOrc } from './deps';
import { CAMPOS_ORIGEM_BLINDADA, recusarCamposBlindados } from './governanca';

// Proposta de TP: capa, Versão 1 e CC próprio (US-065, UC 3.04, 3.05 e 3.07; plano do P17, Task 1).
// O TP é a unidade (§6.7, C31): a criação grava, numa transação, a unidade (código = número do TP,
// cc = CC do TP), o vínculo do criador, a capa, a Versão 1 em Rascunho e o Histórico (D-P17-2, D-P17-3).
// A capa e a versão têm RLS: depois de criar a unidade, o app.unidades da transação é refeito com ela.
// O CC é lido do C1 (sem gravar nada da frente B); a unicidade é do índice unidade_cc_ativa_key (D-P17-7).

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
const uuid = z.uuid();

// O C1 inteiro: os CCs de TP ficam fora da raiz 4 da Adm. Central (C37). Com o deps.estruturaCompleta
// (que vem com o recorte do deps.estrutura à raiz 4), lê dele; sem ele, do deps.estrutura.
type ComEstruturaCompleta = DepsOrc & { estruturaCompleta?: DepsOrc['estrutura'] };
const estruturaInteira = (deps: DepsOrc): DepsOrc['estrutura'] => (deps as ComEstruturaCompleta).estruturaCompleta ?? deps.estrutura;

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

const numeroDuplicado = (numero: string) => falha([{ campo: 'numero', mensagem: M.NUMERO_DUPLICADO(numero) }]);
const ccDeOutroTp = (cc: string) => falha([{ campo: 'cc', mensagem: M.CC_DE_OUTRO_TP(cc) }]);

// Unicidade violada na gravação (corrida entre duas criações): P2002 pelo Prisma ou 23505 no texto.
const violouUnicidade = (e: unknown) =>
  (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') || (e instanceof Error && /\b23505\b/.test(e.message));

/**
 * UC 3.05: cria a proposta. Valida a capa (domínio), o CC contra o C1 e a unicidade do número e do CC
 * (RN_TP_001). Na corrida, o índice único decide: quem perde recebe a mensagem, sem nada gravado.
 */
export async function criarProposta(
  ctx: ContextoRequisicao,
  bruto: unknown,
  depsParciais: Partial<DepsOrc> = {},
): Promise<Resultado<{ id: string; unidadeId: string; numero: string }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'incluir');
  await recusarCamposBlindados(ctx, FUNCIONALIDADE, bruto, CAMPOS_ORIGEM_BLINDADA.proposta, deps);
  const parse = entradaCriar.safeParse(bruto);
  if (!parse.success) return falha([{ campo: '_', mensagem: M.PROPOSTA_DADOS_INVALIDOS }]);
  const v = validarCapa(parse.data);
  if (!v.ok) return v;
  const capa = v.valor;
  if (!(await ccsDeTp(deps)).includes(capa.cc)) return falha([{ campo: 'cc', mensagem: M.CC_INVALIDO_TP(capa.cc) }]);

  try {
    return await deps.cliente.$transaction(async (tx) => {
      // Conferência antes de gravar, para a mensagem certa sem depender do erro do índice.
      if (await tx.unidade.findUnique({ where: { codigo: capa.numero }, select: { id: true } })) return numeroDuplicado(capa.numero);
      if (await tx.unidade.findFirst({ where: { cc: capa.cc, ativo: true }, select: { id: true } })) return ccDeOutroTp(capa.cc);

      const unidade = await tx.unidade.create({ data: { codigo: capa.numero, nome: nomeDaUnidade(capa.objeto), cc: capa.cc } });
      await tx.usuarioUnidade.create({ data: { usuarioId: ctx.usuarioId, unidadeId: unidade.id } });
      // A RLS da capa e da versão exige a unidade nova no app.unidades desta transação.
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
      await tx.versaoProposta.create({ data: { unidadeId: unidade.id, propostaId: proposta.id, numero: 1, situacao: 'RASCUNHO', criadoPor: ctx.usuarioId }, select: { id: true } });

      const contexto = { ...contextoAuditoria(ctx), unidadeId: unidade.id };
      await auditar(tx, {
        contexto,
        funcionalidade: FUNCIONALIDADE,
        tipo: 'INSERCAO',
        registroId: proposta.id,
        descricao: `Proposta do TP ${capa.numero} criada em Rascunho, com o CC ${capa.cc}`,
        depois: retrato(capa, 1, 'RASCUNHO'),
      });
      await auditar(tx, {
        contexto,
        funcionalidade: FUNCIONALIDADE_USUARIOS,
        tipo: 'INSERCAO',
        registroId: ctx.usuarioId,
        descricao: `Unidade ${capa.numero} associada ao usuário ${ctx.usuarioRotulo}, que criou a proposta do TP`,
        depois: { unidade: capa.numero },
      });
      return ok({ id: proposta.id, unidadeId: unidade.id, numero: capa.numero });
    });
  } catch (erro) {
    if (!violouUnicidade(erro)) throw erro;
    // A transação perdeu a corrida: quem ganhou já gravou; a leitura de agora diz qual índice foi.
    if (await deps.cliente.unidade.findUnique({ where: { codigo: capa.numero }, select: { id: true } })) return numeroDuplicado(capa.numero);
    if (await deps.cliente.unidade.findFirst({ where: { cc: capa.cc, ativo: true }, select: { id: true } })) return ccDeOutroTp(capa.cc);
    throw erro;
  }
}

/** UC 3.04: as propostas dos TPs do usuário (RLS), sem as excluídas, pela ordem do número. */
export async function listarPropostas(ctx: ContextoRequisicao, depsParciais: Partial<DepsOrc> = {}): Promise<readonly PropostaTela[]> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const linhas = await emUnidade(
    ctx,
    (tx) =>
      tx.propostaTp.findMany({
        where: { excluidaEm: null },
        include: { unidade: { select: { codigo: true, cc: true } }, versoes: { orderBy: { numero: 'desc' }, take: 1, select: { numero: true, situacao: true } } },
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
          include: { unidade: { select: { codigo: true, cc: true } }, versoes: { orderBy: { numero: 'desc' }, take: 1, select: { numero: true, situacao: true } } },
        });
        if (!p) return inexistente;
        if (p.versao !== versao) return falha([{ campo: '_', mensagem: M.ALTERADO_POR_OUTRO }]);
        const atual = p.versoes[0];
        if (atual?.situacao !== 'RASCUNHO') return falha([{ campo: '_', mensagem: M.PROPOSTA_NAO_EXCLUIVEL }]);

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
          antes: retrato(capa, atual.numero, 'RASCUNHO'),
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
