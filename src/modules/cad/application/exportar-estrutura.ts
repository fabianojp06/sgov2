import 'server-only';
import type { PrismaClient } from '@/generated/prisma/client';
import { criarIdentificacao, type FormatoArquivo, type PlanilhaExportacao } from '@/modules/ger';
import { exportarCsv, exportarXlsx } from '@/modules/ger/servidor';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma, type TxCliente } from '@/shared/db';
import { falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import type { NoCentroCusto, NoConta } from '../domain/estrutura';
import { listarArvoreCentrosCusto, listarArvoreContas } from '../infrastructure/estrutura-financeira';

// Exportação das listagens do plano de contas e dos centros de custo (US-024 parte 2; RN0011 e
// RN_WATERMARK pelo C3). As mesmas linhas da tela, na ordem da árvore, com o filtro "inativas" da
// tela no cabeçalho. O arquivo é gerado antes do Histórico (UC0.05); se a geração falhar, nada é
// gravado. O Histórico leva o formato, a quantidade de registros, os filtros e o rastreio.

export type OpcoesExportacao = { formato: FormatoArquivo; incluirInativos: boolean };
type Deps = { cliente?: PrismaClient };

class FalhaGeracao extends Error {
  constructor(readonly erros: ErroCampo[]) {
    super('geração do arquivo');
  }
}

function emOrdem<T extends { filhos: readonly T[] }>(nos: readonly T[]): T[] {
  return nos.flatMap((n) => [n, ...emOrdem(n.filhos)]);
}

async function exportar(
  ctx: ContextoRequisicao,
  funcionalidade: 'cad.plano_contas' | 'cad.centros_custo',
  titulo: string,
  o: OpcoesExportacao,
  montar: (tx: TxCliente) => Promise<Pick<PlanilhaExportacao, 'nome' | 'colunas' | 'linhas'>>,
  deps: Deps,
): Promise<Resultado<Uint8Array>> {
  exigir(ctx, funcionalidade, 'exportar');
  const cliente = deps.cliente ?? prisma;
  try {
    const bytes = await cliente.$transaction(async (tx) => {
      const filtros = [{ rotulo: 'Inativos', valor: o.incluirInativos ? 'incluídos' : 'não incluídos' }];
      const identificacao = criarIdentificacao({ titulo, filtros, operador: ctx.usuarioRotulo });
      const planilha: PlanilhaExportacao = { ...(await montar(tx)), identificacao };
      const r = o.formato === 'xlsx' ? await exportarXlsx([planilha]) : exportarCsv(planilha);
      if (!r.ok) throw new FalhaGeracao([...r.erros]);
      await auditar(tx, {
        contexto: { usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip, unidadeId: null },
        funcionalidade,
        tipo: 'EXPORTACAO',
        registroId: identificacao.rastreio,
        descricao: `${titulo} exportado em ${o.formato.toUpperCase()} (rastreio ${identificacao.rastreio})`,
        depois: { formato: o.formato, registros: planilha.linhas.length, filtros, rastreio: identificacao.rastreio },
      });
      return r.valor;
    });
    return ok(bytes);
  } catch (e) {
    if (e instanceof FalhaGeracao) return falha(e.erros);
    throw e;
  }
}

const TIPO_CONTA = { SINTETICA: 'Sintética', ANALITICA: 'Analítica' } as const;
const TIPO_CC = { SINTETICO: 'Sintético', ANALITICO: 'Analítico' } as const;
const SIM_NAO = (b: boolean) => (b ? 'Sim' : 'Não');

export function exportarPlanoContas(ctx: ContextoRequisicao, o: OpcoesExportacao, deps: Deps = {}): Promise<Resultado<Uint8Array>> {
  return exportar(
    ctx,
    'cad.plano_contas',
    'Plano de contas',
    o,
    async (tx) => ({
      nome: 'Plano de contas',
      colunas: [
        { titulo: 'Classificação', tipo: 'texto', largura: 110 },
        { titulo: 'Reduzido', tipo: 'texto', largura: 70 },
        { titulo: 'Descrição', tipo: 'texto', largura: 320 },
        { titulo: 'Nível', tipo: 'texto', largura: 50 },
        { titulo: 'Tipo', tipo: 'texto', largura: 80 },
        { titulo: 'Situação', tipo: 'texto', largura: 70 },
      ],
      linhas: emOrdem<NoConta>(await listarArvoreContas(tx, { incluirInativos: o.incluirInativos })).map((c) => [
        c.classificacao,
        c.codigoReduzido,
        c.descricao,
        String(c.nivel),
        TIPO_CONTA[c.tipo],
        c.ativa ? 'Ativa' : 'Inativa',
      ]),
    }),
    deps,
  );
}

export function exportarCentrosCusto(ctx: ContextoRequisicao, o: OpcoesExportacao, deps: Deps = {}): Promise<Resultado<Uint8Array>> {
  return exportar(
    ctx,
    'cad.centros_custo',
    'Centros de custo',
    o,
    async (tx) => ({
      nome: 'Centros de custo',
      colunas: [
        { titulo: 'Classificação', tipo: 'texto', largura: 100 },
        { titulo: 'Reduzido', tipo: 'texto', largura: 70 },
        { titulo: 'Descrição', tipo: 'texto', largura: 320 },
        { titulo: 'Nível', tipo: 'texto', largura: 50 },
        { titulo: 'Tipo', tipo: 'texto', largura: 80 },
        { titulo: 'De gestão', tipo: 'texto', largura: 70 },
        { titulo: 'Provisório', tipo: 'texto', largura: 70 },
        { titulo: 'Situação', tipo: 'texto', largura: 70 },
      ],
      linhas: emOrdem<NoCentroCusto>(await listarArvoreCentrosCusto(tx, { incluirInativos: o.incluirInativos })).map((c) => [
        c.classificacao,
        c.codigoReduzido,
        c.descricao,
        String(c.nivel),
        TIPO_CC[c.tipo],
        SIM_NAO(c.deGestao),
        SIM_NAO(c.provisorio),
        c.ativo ? 'Ativo' : 'Inativo',
      ]),
    }),
    deps,
  );
}
