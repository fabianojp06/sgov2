import 'server-only';
import { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import { obterVisaoExercicio } from '@/modules/orc';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma, type TxCliente } from '@/shared/db';
import { ErroIA, servicoIA, type ServicoIA } from '@/shared/ia';
import { falha, MENSAGEM_CONFLITO, ok, type Resultado } from '@/shared/kernel';
import {
  conferirTextos,
  listaGravada,
  MAXIMO_ITEM_RELATORIO,
  MAXIMO_RESUMO_RELATORIO,
  MAXIMO_TPS_RELATORIO,
  mensagemRelatorio,
  validarMes,
  validarTextos,
  type AdmCentralRelatorio,
  type DadosRelatorio,
  type TextosRelatorio,
  type TpRelatorio,
} from '../domain/relatorio-executivo';
import { obterComparativo, PERMISSAO_CONSOLIDADO } from './comparativo-tps';
import { CASO_RELATORIO_EXECUTIVO } from './ia-casos';

// Relatório executivo mensal (US-103, IA-14), parte 1: o rascunho (indicadores congelados + textos da IA),
// a edição e a aprovação pela GFIN, e o PDF (infrastructure/pdf-relatorio-executivo). O PPTX é a parte 2.
// - Gerar: rel.relatorio_executivo:executar (o caso de IA). Lê a visão da Adm. Central (orc.orcamento) e
//   os TPs pelo comparativo (orc.consolidado, com as regras de privacidade da US-106); sem uma das duas
//   permissões, a parte fica de fora (null). Regerar substitui o rascunho do mês; o aprovado não muda.
// - Editar: rel.relatorio_executivo:alterar, só no rascunho. Aprovar: rel.relatorio_executivo:aprovar.
// - Consultar: quem só consulta vê só os aprovados (o rascunho é da GFIN até a aprovação).
// Tudo vai ao Histórico (funcionalidade rel.relatorio_executivo), com o mês e sem os textos inteiros.

export const FUNCIONALIDADE_RELATORIO = 'rel.relatorio_executivo';
export const TEMPO_LIMITE_RELATORIO_MS = 90_000;

export const MENSAGENS_RELATORIO = {
  SEM_DADOS: 'O seu perfil não consulta a Administração Central nem o Consolidado dos TPs: não há indicador para o relatório.',
  JA_APROVADO: (mes: string) => `O relatório de ${mes} já foi aprovado e não pode ser gerado de novo.`,
  NAO_ENCONTRADO: 'Relatório não encontrado. Recarregue a tela.',
  SO_RASCUNHO: 'Só o rascunho pode ser alterado ou aprovado.',
  TEMPO_ESGOTADO: 'A IA demorou demais para responder. Tente de novo.',
} as const;

const SAIDA = z.object({
  resumo: z.string().max(MAXIMO_RESUMO_RELATORIO),
  // Sem teto no número de itens: a conferência corta.
  riscos: z.array(z.string().max(MAXIMO_ITEM_RELATORIO)),
  recomendacoes: z.array(z.string().max(MAXIMO_ITEM_RELATORIO)),
});

type LerAdmCentral = (ctx: ContextoRequisicao, ano: number) => Promise<AdmCentralRelatorio | null>;
type LerTps = (ctx: ContextoRequisicao) => Promise<{ tps: TpRelatorio[]; omitidos: number } | null>;
export type DepsRelatorio = {
  cliente: PrismaClient;
  ia: ServicoIA;
  sinalIa: () => AbortSignal;
  agora: () => Date;
  lerAdmCentral: LerAdmCentral;
  lerTps: LerTps;
};

const LER_ADM_CENTRAL: LerAdmCentral = async (ctx, ano) => {
  if (!ctx.permissoes.has('orc.orcamento:consultar')) return null;
  const v = await obterVisaoExercicio(ctx, ano, null);
  if (!v) return null;
  return {
    ano: v.exercicio.ano,
    situacao: v.exercicio.rotuloSituacao,
    orcamentoAno: v.indicadores.orcamentoAno.paraString(),
    pessoal: v.indicadores.pessoal.paraString(),
    percentualPessoal: v.indicadores.percentualPessoal?.paraString() ?? null,
    empregadosDezembro: v.indicadores.empregadosDezembro,
    tetoEfetivo: v.painel?.tetoEfetivo.paraString() ?? null,
    usoDoTeto: v.painel?.uso?.paraString() ?? null,
    resultadoAno: v.painel?.resultadoAno.paraString() ?? null,
    saldo: v.painel?.saldo.paraString() ?? null,
  };
};

// Pelo comparativo da US-106: o mesmo caminho do consolidado, o Histórico dele e o cache de 60 s.
const LER_TPS: LerTps = async (ctx) => {
  if (!ctx.permissoes.has(PERMISSAO_CONSOLIDADO)) return null;
  const c = await obterComparativo(ctx);
  if (!c.ok) return null;
  const tps = c.valor.tps.map((t) => ({ numero: t.numero, oficial: t.oficial, valorGlobal: t.valorGlobal ?? '0.00', execucao: t.indicadores.execucao }));
  return { tps: tps.slice(0, MAXIMO_TPS_RELATORIO), omitidos: c.valor.tpsOmitidos + Math.max(0, tps.length - MAXIMO_TPS_RELATORIO) };
};

const resolver = (d: Partial<DepsRelatorio>): DepsRelatorio => ({
  cliente: d.cliente ?? prisma,
  ia: d.ia ?? servicoIA,
  sinalIa: d.sinalIa ?? (() => AbortSignal.timeout(TEMPO_LIMITE_RELATORIO_MS)),
  agora: d.agora ?? (() => new Date()),
  lerAdmCentral: d.lerAdmCentral ?? LER_ADM_CENTRAL,
  lerTps: d.lerTps ?? LER_TPS,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const erro = (mensagem: string, campo = '_'): Resultado<never> => falha([{ campo, mensagem }]);
const tempoEsgotado = (sinal: AbortSignal) => sinal.aborted && (sinal.reason as { name?: unknown } | undefined)?.name === 'TimeoutError';
const mesDe = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const contextoDe = (ctx: ContextoRequisicao) => ({ usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip, unidadeId: null });
const podeVerRascunho = (ctx: ContextoRequisicao) =>
  ctx.permissoes.has(`${FUNCIONALIDADE_RELATORIO}:alterar`) || ctx.permissoes.has(`${FUNCIONALIDADE_RELATORIO}:aprovar`) || ctx.permissoes.has(`${FUNCIONALIDADE_RELATORIO}:executar`);

export type ResumoRelatorio = { id: string; mes: string; situacao: 'RASCUNHO' | 'APROVADO'; geradoEm: Date; aprovadoRotulo: string | null; aprovadoEm: Date | null };
export type RelatorioTela = ResumoRelatorio & { versao: number; dados: DadosRelatorio; textos: TextosRelatorio };

const SELECAO = { id: true, mes: true, situacao: true, geradoEm: true, aprovadoRotulo: true, aprovadoEm: true } as const;

export async function listarRelatorios(ctx: ContextoRequisicao, deps: Partial<Pick<DepsRelatorio, 'cliente'>> = {}): Promise<readonly ResumoRelatorio[]> {
  exigir(ctx, FUNCIONALIDADE_RELATORIO, 'consultar');
  return (deps.cliente ?? prisma).relatorioExecutivo.findMany({
    where: podeVerRascunho(ctx) ? {} : { situacao: 'APROVADO' },
    orderBy: { mes: 'desc' },
    take: 36,
    select: SELECAO,
  });
}

export async function obterRelatorio(ctx: ContextoRequisicao, id: string, deps: Partial<Pick<DepsRelatorio, 'cliente'>> = {}): Promise<RelatorioTela | null> {
  exigir(ctx, FUNCIONALIDADE_RELATORIO, 'consultar');
  if (!UUID.test(id)) return null;
  const r = await (deps.cliente ?? prisma).relatorioExecutivo.findUnique({
    where: { id },
    select: { ...SELECAO, versao: true, dados: true, resumo: true, riscos: true, recomendacoes: true },
  });
  if (!r || (r.situacao !== 'APROVADO' && !podeVerRascunho(ctx))) return null;
  return {
    id: r.id,
    mes: r.mes,
    situacao: r.situacao,
    geradoEm: r.geradoEm,
    aprovadoRotulo: r.aprovadoRotulo,
    aprovadoEm: r.aprovadoEm,
    versao: r.versao,
    dados: r.dados as DadosRelatorio,
    textos: { resumo: r.resumo, riscos: listaGravada(r.riscos), recomendacoes: listaGravada(r.recomendacoes) },
  };
}

/** O botão de gerar aparece? A permissão do caso, a chave geral, o caso ativo e os tetos (sem reservar). */
export function geracaoRelatorioLiberada(ctx: ContextoRequisicao, deps: Partial<Pick<DepsRelatorio, 'ia'>> = {}): Promise<boolean> {
  return (deps.ia ?? servicoIA).disponivel(ctx, CASO_RELATORIO_EXECUTIVO);
}

/** Gera (ou regera) o rascunho do mês: indicadores congelados e os textos da IA. */
export async function gerarRascunho(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsRelatorio> = {}): Promise<Resultado<{ id: string; mes: string }>> {
  if (!ctx.permissoes.has(`${FUNCIONALIDADE_RELATORIO}:executar`)) return erro(new ErroIA('ia.sem_permissao').message);
  const deps = resolver(depsParciais);
  const mes = validarMes((bruto as { mes?: unknown } | null)?.mes, mesDe(deps.agora()));
  if (!mes.ok) return mes;
  const existente = await deps.cliente.relatorioExecutivo.findUnique({ where: { mes: mes.valor }, select: { id: true, situacao: true, versao: true } });
  if (existente?.situacao === 'APROVADO') return erro(MENSAGENS_RELATORIO.JA_APROVADO(mes.valor), 'mes');
  // Caso desligado ou teto estourado: recusa antes da leitura (a dos TPs grava a CONSULTA no Histórico).
  if (!(await deps.ia.disponivel(ctx, CASO_RELATORIO_EXECUTIVO))) return erro(new ErroIA('ia.desligada').message);

  const ano = Number(mes.valor.slice(0, 4));
  const [admCentral, lidosTps] = await Promise.all([deps.lerAdmCentral(ctx, ano), deps.lerTps(ctx)]);
  if (!admCentral && !lidosTps) return erro(MENSAGENS_RELATORIO.SEM_DADOS);
  const dados: DadosRelatorio = { mes: mes.valor, admCentral, tps: lidosTps?.tps ?? null, tpsOmitidos: lidosTps?.omitidos ?? 0 };

  const sinal = deps.sinalIa();
  let textos: TextosRelatorio;
  try {
    const r = await deps.ia.gerarEstruturado(ctx, CASO_RELATORIO_EXECUTIVO, mensagemRelatorio(dados), SAIDA, sinal);
    textos = conferirTextos(r.valor);
  } catch (x) {
    if (!(x instanceof ErroIA)) throw x;
    return erro(x.codigo === 'ia.cancelada' && tempoEsgotado(sinal) ? MENSAGENS_RELATORIO.TEMPO_ESGOTADO : x.message);
  }
  if (textos.resumo.length === 0) return erro(new ErroIA('ia.saida_invalida').message);

  return deps.cliente.$transaction(async (tx: TxCliente) => {
    const conteudo = { dados, resumo: textos.resumo, riscos: textos.riscos, recomendacoes: textos.recomendacoes, geradoPor: ctx.usuarioId, geradoEm: new Date() };
    let id: string;
    if (existente) {
      // Só substitui o rascunho lido; um aprovado no meio do caminho (ou outra geração) dá conflito.
      const r = await tx.relatorioExecutivo.updateMany({ where: { id: existente.id, versao: existente.versao, situacao: 'RASCUNHO' }, data: { ...conteudo, versao: { increment: 1 } } });
      if (r.count === 0) return erro(MENSAGEM_CONFLITO);
      id = existente.id;
    } else {
      id = (await tx.relatorioExecutivo.create({ data: { mes: mes.valor, ...conteudo }, select: { id: true } })).id;
    }
    await auditar(tx, {
      contexto: contextoDe(ctx),
      funcionalidade: FUNCIONALIDADE_RELATORIO,
      tipo: existente ? 'ALTERACAO' : 'INSERCAO',
      registroId: id,
      descricao: `Rascunho do relatório executivo de ${mes.valor} ${existente ? 'gerado de novo' : 'gerado'} com IA`,
      ...(existente ? { antes: { mes: mes.valor, situacao: 'RASCUNHO', versao: existente.versao } } : {}),
      depois: { mes: mes.valor, situacao: 'RASCUNHO', tps: dados.tps?.length ?? 0, admCentral: dados.admCentral !== null },
      origem: 'SUGESTAO_IA',
    });
    return ok({ id, mes: mes.valor });
  });
}

const entradaTextos = z.object({ id: z.string(), versao: z.coerce.number().int().min(1), resumo: z.string().max(MAXIMO_RESUMO_RELATORIO * 2), riscos: z.string().max(10_000), recomendacoes: z.string().max(10_000) });

/** A GFIN edita os textos do rascunho (uma linha por item nas listas). */
export async function alterarTextos(ctx: ContextoRequisicao, bruto: unknown, deps: Partial<Pick<DepsRelatorio, 'cliente'>> = {}): Promise<Resultado<{ versao: number }>> {
  exigir(ctx, FUNCIONALIDADE_RELATORIO, 'alterar');
  const e = entradaTextos.safeParse(bruto);
  if (!e.success || !UUID.test(e.data.id)) return erro(MENSAGENS_RELATORIO.NAO_ENCONTRADO);
  const v = validarTextos(e.data);
  if (!v.ok) return v;
  return (deps.cliente ?? prisma).$transaction(async (tx: TxCliente) => {
    const antes = await tx.relatorioExecutivo.findUnique({ where: { id: e.data.id }, select: { mes: true, situacao: true, versao: true } });
    if (!antes) return erro(MENSAGENS_RELATORIO.NAO_ENCONTRADO);
    if (antes.situacao !== 'RASCUNHO') return erro(MENSAGENS_RELATORIO.SO_RASCUNHO);
    const r = await tx.relatorioExecutivo.updateMany({
      where: { id: e.data.id, versao: e.data.versao, situacao: 'RASCUNHO' },
      data: { resumo: v.valor.resumo, riscos: v.valor.riscos, recomendacoes: v.valor.recomendacoes, versao: { increment: 1 } },
    });
    if (r.count === 0) return erro(MENSAGEM_CONFLITO);
    await auditar(tx, {
      contexto: contextoDe(ctx),
      funcionalidade: FUNCIONALIDADE_RELATORIO,
      tipo: 'ALTERACAO',
      registroId: e.data.id,
      descricao: `Textos do relatório executivo de ${antes.mes} revisados`,
      antes: { mes: antes.mes, versao: antes.versao },
      depois: { mes: antes.mes, riscos: v.valor.riscos.length, recomendacoes: v.valor.recomendacoes.length },
    });
    return ok({ versao: e.data.versao + 1 });
  });
}

const entradaAprovar = z.object({ id: z.string(), versao: z.coerce.number().int().min(1) });

/** A GFIN aprova o rascunho: a partir daí ele não muda e pode ser distribuído. */
export async function aprovarRelatorio(ctx: ContextoRequisicao, bruto: unknown, deps: Partial<Pick<DepsRelatorio, 'cliente' | 'agora'>> = {}): Promise<Resultado<{ mes: string }>> {
  exigir(ctx, FUNCIONALIDADE_RELATORIO, 'aprovar');
  const e = entradaAprovar.safeParse(bruto);
  if (!e.success || !UUID.test(e.data.id)) return erro(MENSAGENS_RELATORIO.NAO_ENCONTRADO);
  return (deps.cliente ?? prisma).$transaction(async (tx: TxCliente) => {
    const antes = await tx.relatorioExecutivo.findUnique({ where: { id: e.data.id }, select: { mes: true, situacao: true } });
    if (!antes) return erro(MENSAGENS_RELATORIO.NAO_ENCONTRADO);
    if (antes.situacao !== 'RASCUNHO') return erro(MENSAGENS_RELATORIO.SO_RASCUNHO);
    const r = await tx.relatorioExecutivo.updateMany({
      where: { id: e.data.id, versao: e.data.versao, situacao: 'RASCUNHO' },
      data: { situacao: 'APROVADO', aprovadoPor: ctx.usuarioId, aprovadoRotulo: ctx.usuarioRotulo, aprovadoEm: (deps.agora ?? (() => new Date()))(), versao: { increment: 1 } },
    });
    if (r.count === 0) return erro(MENSAGEM_CONFLITO);
    await auditar(tx, {
      contexto: contextoDe(ctx),
      funcionalidade: FUNCIONALIDADE_RELATORIO,
      tipo: 'ALTERACAO',
      registroId: e.data.id,
      descricao: `Relatório executivo de ${antes.mes} aprovado`,
      antes: { situacao: 'RASCUNHO' },
      depois: { situacao: 'APROVADO' },
    });
    return ok({ mes: antes.mes });
  });
}

/** O PDF do relatório (rel.relatorio_executivo:exportar), com a EXPORTACAO no Histórico. O rascunho só para quem o vê. */
export async function exportarPdfRelatorio(
  ctx: ContextoRequisicao,
  id: string,
  deps: Partial<Pick<DepsRelatorio, 'cliente'>> = {},
): Promise<Resultado<{ nome: string; bytes: Uint8Array }>> {
  exigir(ctx, FUNCIONALIDADE_RELATORIO, 'exportar');
  const cliente = deps.cliente ?? prisma;
  const r = await obterRelatorio(ctx, id, { cliente });
  if (!r) return erro(MENSAGENS_RELATORIO.NAO_ENCONTRADO);
  const { gerarPdfRelatorio, nomeArquivoRelatorio, tituloRelatorio } = await import('../infrastructure/pdf-relatorio-executivo');
  const aprovacao = r.aprovadoEm ? `${r.aprovadoRotulo ?? ''} em ${r.aprovadoEm.toISOString().slice(0, 10).split('-').reverse().join('/')}` : null;
  const bytes = await gerarPdfRelatorio(r.dados, r.textos, { titulo: tituloRelatorio(r.mes), situacao: r.situacao, aprovacao, emitidoPor: ctx.usuarioRotulo });
  await cliente.$transaction(async (tx: TxCliente) => {
    await auditar(tx, {
      contexto: contextoDe(ctx),
      funcionalidade: FUNCIONALIDADE_RELATORIO,
      tipo: 'EXPORTACAO',
      registroId: r.id,
      descricao: `Relatório executivo de ${r.mes} exportado em PDF (${r.situacao === 'RASCUNHO' ? 'rascunho' : 'aprovado'})`,
    });
  });
  return ok({ nome: nomeArquivoRelatorio(r.mes, r.situacao), bytes });
}
