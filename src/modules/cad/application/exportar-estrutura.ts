import 'server-only';
import type { PrismaClient } from '@/generated/prisma/client';
import { criarIdentificacao, type FormatoArquivo } from '@/modules/ger';
import { agendarExportacao, exportarCsv, exportarXlsx, LIMITE_EXPORTACAO_ASSINCRONA, LIMITE_EXPORTACAO_SINCRONA } from '@/modules/ger/servidor';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma } from '@/shared/db';
import { falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { ARVORE_CENTROS, ARVORE_PLANO, montarConteudo, validarFiltrosArvore, type Arvore, type ParametrosEstrutura } from './planilha-estrutura';

// Exportação das listagens do plano de contas e dos centros de custo (US-024, partes 2 a 4; RN0011 e
// RN_WATERMARK pelo C3). O arquivo é o que a tela mostra (planilha-estrutura.ts), com os filtros no
// cabeçalho. Até 5.000 linhas, sai na hora: o arquivo é gerado antes do Histórico (UC0.05) e, se a
// geração falhar, nada é gravado; o Histórico leva o formato, os registros, os filtros e o rastreio.
// Acima disso (RF_IMP_003), vira um pedido para o worker, na mesma transação da contagem.

export type OpcoesExportacao = ParametrosEstrutura & { formato: FormatoArquivo };
export type ExportacaoEstrutura = { tipo: 'arquivo'; nome: string; bytes: Uint8Array } | { tipo: 'agendada'; pedidoId: string };
// limiteSincrono: só para os testes da exportação assíncrona.
type Deps = { cliente?: PrismaClient; limiteSincrono?: number };

class FalhaGeracao extends Error {
  constructor(readonly erros: ErroCampo[]) {
    super('geração do arquivo');
  }
}

async function exportarArvore<C extends string>(ctx: ContextoRequisicao, a: Arvore<C>, o: OpcoesExportacao, deps: Deps): Promise<Resultado<ExportacaoEstrutura>> {
  exigir(ctx, a.funcionalidade, 'exportar');
  const v = validarFiltrosArvore(a, o.filtros);
  if (!v.ok) return falha(v.erros);
  const cliente = deps.cliente ?? prisma;
  try {
    const r = await cliente.$transaction(async (tx): Promise<ExportacaoEstrutura> => {
      const c = await montarConteudo(tx, a, { incluirInativos: o.incluirInativos, filtros: v.valor });
      if (!c.ok) throw new FalhaGeracao([...c.erros]);
      const nome = `${a.arquivo}.${o.formato}`;
      const total = c.valor.planilha.linhas.length;
      // Acima do teto assíncrono, o worker também recusaria: avisa já, sem pedido.
      if (total > LIMITE_EXPORTACAO_ASSINCRONA) {
        throw new FalhaGeracao([{ campo: 'linhas', mensagem: `A exportação tem ${total} linhas; o máximo é ${LIMITE_EXPORTACAO_ASSINCRONA}. Use filtros para reduzir.` }]);
      }
      if (total > (deps.limiteSincrono ?? LIMITE_EXPORTACAO_SINCRONA)) {
        const pedido = await agendarExportacao(tx, {
          contexto: { usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip },
          funcionalidade: a.funcionalidade,
          titulo: a.titulo,
          formato: o.formato,
          nomeArquivo: nome,
          parametros: { incluirInativos: o.incluirInativos, filtros: v.valor },
        });
        if (!pedido.ok) throw new FalhaGeracao([...pedido.erros]);
        return { tipo: 'agendada', pedidoId: pedido.valor };
      }
      const identificacao = criarIdentificacao({ titulo: a.titulo, filtros: c.valor.filtros, operador: ctx.usuarioRotulo });
      const planilha = { ...c.valor.planilha, identificacao };
      const arquivo = o.formato === 'xlsx' ? await exportarXlsx([planilha]) : exportarCsv(planilha);
      if (!arquivo.ok) throw new FalhaGeracao([...arquivo.erros]);
      await auditar(tx, {
        contexto: { usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip, unidadeId: null },
        funcionalidade: a.funcionalidade,
        tipo: 'EXPORTACAO',
        registroId: identificacao.rastreio,
        descricao: `${a.titulo} exportado em ${o.formato.toUpperCase()} (rastreio ${identificacao.rastreio})`,
        depois: { formato: o.formato, registros: planilha.linhas.length, filtros: c.valor.filtros, rastreio: identificacao.rastreio },
      });
      return { tipo: 'arquivo', nome, bytes: arquivo.valor };
    });
    return ok(r);
  } catch (e) {
    if (e instanceof FalhaGeracao) return falha(e.erros);
    throw e;
  }
}

export const exportarPlanoContas = (ctx: ContextoRequisicao, o: OpcoesExportacao, deps: Deps = {}) => exportarArvore(ctx, ARVORE_PLANO, o, deps);
export const exportarCentrosCusto = (ctx: ContextoRequisicao, o: OpcoesExportacao, deps: Deps = {}) => exportarArvore(ctx, ARVORE_CENTROS, o, deps);
