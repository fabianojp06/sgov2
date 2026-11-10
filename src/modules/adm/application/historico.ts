import type { PrismaClient } from '@/generated/prisma/client';
import { auditar, type TipoOperacao } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { agendarExportacao, exportarXlsx, LIMITE_EXPORTACAO_ASSINCRONA, MENSAGEM_MUITOS_PENDENTES } from '@/modules/ger/servidor';
import { LIMITE_EXPORTACAO_SINCRONA } from '@/modules/ger';
import { prisma } from '@/shared/db';
import { falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import {
  CAMPOS_EXPORTACAO,
  COLUNAS_HISTORICO,
  descreverFiltros,
  diaBrasilia,
  filtroDoHistorico,
  FUNCIONALIDADE_HISTORICO,
  linhaDaExportacao,
  MENSAGEM_PERIODO,
  parametrosDoPedido,
  periodoValido,
  TITULO_HISTORICO,
  validarFiltroHistorico,
  type FiltroHistorico,
} from './planilha-historico';

// Consulta do Histórico de Operações (US-040, UC02.24; REQ00100 a REQ00103): só leitura, com filtro
// e paginação no banco. O Administrador vê tudo; os outros perfis veem só as funcionalidades do
// próprio perfil (RN0099), nunca os registros fora do catálogo (RN0100). O `ate` é um instante: quem
// monta o filtro pela tela leva-o até o fim do dia (Task 7). A unidade (TP) não recorta: hoje só o
// Administrador e o Auditor, perfis globais, têm adm.historico; o recorte por TP fica para a US-007
// nas tabelas de TP (pendência registrada). Só os campos da listagem
// do UC02.24: sem antes/depois, que ainda não têm a máscara por perfil (D-P8-10). A consulta tem
// nível Avançado (§5) e grava um CONSULTA com os filtros. O alcance, os filtros e as colunas ficam no
// planilha-historico.ts, que o worker também usa.
export type DepsHistorico = { cliente: PrismaClient };

export type LinhaHistorico = { id: string; descricao: string; usuario: string; funcionalidade: string; ocorridoEm: Date; tipo: TipoOperacao };
export type PaginaHistorico = { linhas: LinhaHistorico[]; total: number; pagina: number; porPagina: number };
export { FUNCIONALIDADE_HISTORICO, MENSAGEM_PERIODO, MENSAGEM_USUARIO_FILTRO, type FiltroHistorico } from './planilha-historico';

export const POR_PAGINA = 50;

export async function consultarHistorico(ctx: ContextoRequisicao, f: FiltroHistorico, deps: Partial<DepsHistorico> = {}): Promise<Resultado<PaginaHistorico>> {
  exigir(ctx, FUNCIONALIDADE_HISTORICO, 'consultar');
  const cliente = deps.cliente ?? prisma;
  const v = validarFiltroHistorico(f);
  if (!v.ok) return v;
  // Página fora do número (NaN, Infinity) vira a primeira, sem chegar ao banco.
  const pagina = Number.isFinite(f.pagina) ? Math.min(Math.max(1, Math.trunc(f.pagina)), 1_000_000) : 1;
  const where = await filtroDoHistorico(ctx.usuarioId, f, cliente);
  return cliente.$transaction(async (tx) => {
    const [linhas, total] = await Promise.all([
      tx.historicoOperacao.findMany({
        where,
        orderBy: [{ ocorridoEm: 'desc' }, { id: 'desc' }],
        skip: (pagina - 1) * POR_PAGINA,
        take: POR_PAGINA,
        select: { id: true, descricao: true, usuarioRotulo: true, funcionalidade: true, ocorridoEm: true, tipoOperacao: true },
      }),
      tx.historicoOperacao.count({ where }),
    ]);
    await auditar(tx, {
      contexto: { usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip, unidadeId: null },
      funcionalidade: FUNCIONALIDADE_HISTORICO,
      tipo: 'CONSULTA',
      descricao: `Consultou o Histórico: ${descreverFiltros(f)}, página ${pagina}`,
    });
    return ok({
      linhas: linhas.map((l) => ({ id: l.id.toString(), descricao: l.descricao, usuario: l.usuarioRotulo, funcionalidade: l.funcionalidade, ocorridoEm: l.ocorridoEm, tipo: l.tipoOperacao })),
      total,
      pagina,
      porPagina: POR_PAGINA,
    });
  });
}

// [PROVISÓRIO] (D-P8-11): acima do teto da exportação assíncrona (US-024), recusa. O PDF é da US-024.
export const MENSAGEM_EXPORTACAO_LIMITE = `A exportação passa de ${LIMITE_EXPORTACAO_ASSINCRONA.toLocaleString('pt-BR')} linhas. Reduza o período ou os filtros.`;
// [PROVISÓRIO] Outra recusa do arquivo da hora (ex.: o Histórico cresceu entre a contagem e a leitura e
// passou do limite síncrono do ger): não é o teto assíncrono, então a tela não pode dizer que é.
export const MENSAGEM_EXPORTACAO_FALHOU = 'Não foi possível gerar a exportação agora. Tente de novo.';
// [PROVISÓRIO] Acima de 5.000 linhas (RF_IMP_003), o pedido vai para o worker; a tela aponta para Minhas exportações.
export const MENSAGEM_EXPORTACAO_AGENDADA = 'A exportação passa de 5.000 linhas e está sendo gerada em segundo plano. O arquivo fica disponível em Minhas exportações.';
const contexto = (ctx: ContextoRequisicao) => ({ usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip, unidadeId: null });

export type ExportacaoHistorico = { tipo: 'arquivo'; bytes: Uint8Array; nome: string } | { tipo: 'agendada'; pedidoId: string };
// limiteSincrono: só para os testes da exportação assíncrona.
type DepsExportacao = Partial<DepsHistorico> & { limiteSincrono?: number };

// Os avisos da tela depois de uma recusa (a rota volta à tela com ?aviso=).
export const AVISOS_EXPORTACAO_HISTORICO: Readonly<Record<string, string>> = {
  'exportacao-recusada': MENSAGEM_EXPORTACAO_LIMITE,
  'exportacao-pendentes': MENSAGEM_MUITOS_PENDENTES,
  'exportacao-falhou': MENSAGEM_EXPORTACAO_FALHOU,
};
export const avisoDaRecusa = (erros: readonly ErroCampo[]): string => {
  if (erros.some((e) => e.mensagem === MENSAGEM_MUITOS_PENDENTES)) return 'exportacao-pendentes';
  if (erros.some((e) => e.mensagem === MENSAGEM_EXPORTACAO_LIMITE)) return 'exportacao-recusada';
  return 'exportacao-falhou';
};

// Exportar (UC0.05; RN_LOG_EXP): XLSX até o limite síncrono, com os filtros na primeira linha (RN0011),
// e um EXPORTACAO no Histórico com a quantidade e os filtros. Acima dele (RF_IMP_003), vira um pedido
// para o worker, na mesma transação da contagem: o gerador (planilha-historico.ts) refaz o alcance e
// a permissão de quem pediu na hora de gerar, e o worker registra o EXPORTACAO quando o arquivo fica
// pronto. Acima do teto assíncrono, recusa sem pedido.
export async function exportarHistorico(ctx: ContextoRequisicao, f: Omit<FiltroHistorico, 'pagina'>, deps: DepsExportacao = {}): Promise<Resultado<ExportacaoHistorico>> {
  exigir(ctx, FUNCIONALIDADE_HISTORICO, 'exportar');
  const cliente = deps.cliente ?? prisma;
  const v = validarFiltroHistorico(f);
  if (!v.ok) return v;
  const where = await filtroDoHistorico(ctx.usuarioId, f, cliente);
  return cliente.$transaction(async (tx): Promise<Resultado<ExportacaoHistorico>> => {
    const total = await tx.historicoOperacao.count({ where });
    if (total > LIMITE_EXPORTACAO_ASSINCRONA) return falha([{ campo: '_', mensagem: MENSAGEM_EXPORTACAO_LIMITE }]);
    const nome = `historico-${diaBrasilia(f.de)}-a-${diaBrasilia(f.ate)}.xlsx`;
    // A linha dos filtros conta no limite do ger: cabem LIMITE − 1 registros no arquivo da hora.
    if (total > (deps.limiteSincrono ?? LIMITE_EXPORTACAO_SINCRONA) - 1) {
      const pedido = await agendarExportacao(tx, {
        contexto: { usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip },
        funcionalidade: FUNCIONALIDADE_HISTORICO,
        titulo: TITULO_HISTORICO,
        formato: 'xlsx',
        nomeArquivo: nome,
        parametros: parametrosDoPedido(ctx.usuarioId, f),
      });
      return pedido.ok ? ok({ tipo: 'agendada', pedidoId: pedido.valor }) : falha(pedido.erros);
    }
    const linhas = await tx.historicoOperacao.findMany({ where, orderBy: [{ ocorridoEm: 'desc' }, { id: 'desc' }], select: CAMPOS_EXPORTACAO });
    const filtros = descreverFiltros(f);
    const arquivo = await exportarXlsx([
      {
        nome: TITULO_HISTORICO,
        colunas: COLUNAS_HISTORICO,
        linhas: [[`Filtros: ${filtros}`, null, null, null, null], ...linhas.map(linhaDaExportacao)],
      },
    ]);
    if (!arquivo.ok) return arquivo;
    await auditar(tx, {
      contexto: contexto(ctx),
      funcionalidade: FUNCIONALIDADE_HISTORICO,
      tipo: 'EXPORTACAO',
      descricao: `Exportou ${linhas.length} registro(s) do Histórico: ${filtros}`,
    });
    return ok({ tipo: 'arquivo', bytes: arquivo.valor, nome });
  });
}

// Imprimir (UC0.05): a impressão é a do navegador; o servidor só registra o IMPRESSAO com os filtros.
export async function registrarImpressao(ctx: ContextoRequisicao, f: Omit<FiltroHistorico, 'pagina'>, deps: Partial<DepsHistorico> = {}): Promise<Resultado<void>> {
  exigir(ctx, FUNCIONALIDADE_HISTORICO, 'imprimir');
  if (!periodoValido(f)) return falha([{ campo: 'de', mensagem: MENSAGEM_PERIODO }]);
  await (deps.cliente ?? prisma).$transaction((tx) =>
    auditar(tx, { contexto: contexto(ctx), funcionalidade: FUNCIONALIDADE_HISTORICO, tipo: 'IMPRESSAO', descricao: `Imprimiu o Histórico: ${descreverFiltros(f)}` }),
  );
  return ok(undefined);
}
