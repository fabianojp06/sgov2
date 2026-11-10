import type { PrismaClient } from '@/generated/prisma/client';
import { auditar, type ContextoAuditoria } from '@/shared/audit';
import { lerEnvAcesso } from '@/shared/config';
import type { TxCliente } from '@/shared/db';
import { registrarNoOutbox } from '@/shared/filas/outbox';
import { ErroDominio, falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import type { FormatoArquivo } from '../application/download';
import { enviarEmail } from '../application/email';
import { criarIdentificacao, LIMITE_EXPORTACAO_ASSINCRONA, type FiltroExportacao, type PlanilhaExportacao } from './exportacao';
import { exportarCsv } from './exportar-csv';
import { exportarXlsx } from './exportar-xlsx';

// Exportação assíncrona (US-024, RF_IMP_003): acima de 5.000 linhas, a tela grava um pedido e o worker
// gera o arquivo pela fila exportacao.gerar. Cada módulo dono da listagem registra um gerador por
// funcionalidade (o worker injeta os geradores: o ger não importa os módulos). Sem server-only: roda
// no worker.

export const FILA_EXPORTACAO = 'exportacao.gerar' as const;
// Geração de até 100.000 linhas numa transação: bem acima dos 5 s padrão do Prisma.
const TEMPO_GERACAO_MS = 5 * 60_000;
const MAX_ERRO = 500;
// Retenção e limites [PROVISÓRIOS, decisão da frente B em 10/11]: o arquivo fica 7 dias; pendente há
// mais de 2 h (a fila já esgotou as tentativas: 6, com backoff a partir de 30 s) vira falha; cada
// pessoa tem no máximo 3 pedidos pendentes.
export const DIAS_EXPORTACAO_DISPONIVEL = 7;
export const HORAS_PENDENTE_SEM_RESPOSTA = 2;
export const MAX_PENDENTES_POR_PESSOA = 3;
export const MENSAGEM_SEM_RESPOSTA = 'A geração não terminou. Peça a exportação de novo.';
export const MENSAGEM_MUITOS_PENDENTES = `Você já tem ${MAX_PENDENTES_POR_PESSOA} exportações em geração. Aguarde uma terminar em Minhas exportações.`;

/** O conteúdo do arquivo: as colunas e as linhas da tela e os filtros legíveis para o cabeçalho. */
export type ConteudoExportacao = { planilha: Omit<PlanilhaExportacao, 'identificacao'>; filtros: FiltroExportacao[] };
/** Monta o conteúdo a partir das opções gravadas no pedido (revalidadas: vêm do banco). */
export type GeradorExportacao = (tx: TxCliente, parametros: unknown) => Promise<Resultado<ConteudoExportacao>>;

export type PedidoExportacao = {
  contexto: Omit<ContextoAuditoria, 'usuarioId' | 'sessaoUid'> & { usuarioId: string; sessaoUid: string };
  funcionalidade: string;
  titulo: string;
  formato: FormatoArquivo;
  nomeArquivo: string;
  parametros: object;
};

/**
 * Grava o pedido e a mensagem da fila na transação da tela: o job só existe se o pedido commitar.
 * Devolve o id, que é o rastreio do arquivo e do Histórico. Recusa com MAX_PENDENTES_POR_PESSOA
 * pedidos da pessoa ainda em geração (cliques repetidos não enchem o banco).
 */
export async function agendarExportacao(tx: TxCliente, p: PedidoExportacao): Promise<Resultado<string>> {
  // Trava as linhas pendentes da pessoa: dois pedidos simultâneos não passam juntos do limite.
  const pendentes = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM exportacao_pedido WHERE usuario_id = ${p.contexto.usuarioId}::uuid AND situacao = 'PENDENTE' FOR UPDATE`;
  if (pendentes.length >= MAX_PENDENTES_POR_PESSOA) return falha([{ campo: '_', mensagem: MENSAGEM_MUITOS_PENDENTES }]);
  const { id } = await tx.exportacaoPedido.create({
    data: {
      usuarioId: p.contexto.usuarioId,
      usuarioRotulo: p.contexto.usuarioRotulo,
      sessaoUid: p.contexto.sessaoUid,
      ip: p.contexto.ip,
      funcionalidade: p.funcionalidade,
      titulo: p.titulo,
      formato: p.formato,
      nomeArquivo: p.nomeArquivo,
      parametros: p.parametros as never,
    },
    select: { id: true },
  });
  await registrarNoOutbox(tx, FILA_EXPORTACAO, { pedidoId: id });
  return ok(id);
}

/**
 * Limpeza periódica (worker): pendente há mais de HORAS_PENDENTE_SEM_RESPOSTA vira FALHOU (a fila
 * desistiu, ou o job se perdeu) e pedido com mais de DIAS_EXPORTACAO_DISPONIVEL é apagado, com o arquivo.
 */
export async function limparExportacoes(cliente: PrismaClient, agora: Date): Promise<{ semResposta: number; apagados: number }> {
  const limitePendente = new Date(agora.getTime() - HORAS_PENDENTE_SEM_RESPOSTA * 3600_000);
  const vencimento = new Date(agora.getTime() - DIAS_EXPORTACAO_DISPONIVEL * 24 * 3600_000);
  const semResposta = await cliente.exportacaoPedido.updateMany({
    where: { situacao: 'PENDENTE', criadoEm: { lt: limitePendente } },
    data: { situacao: 'FALHOU', erro: MENSAGEM_SEM_RESPOSTA, concluidoEm: agora },
  });
  const apagados = await cliente.exportacaoPedido.deleteMany({ where: { criadoEm: { lt: vencimento } } });
  return { semResposta: semResposta.count, apagados: apagados.count };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function lerPedidoId(dados: unknown): string | null {
  const id = (dados as { pedidoId?: unknown } | null)?.pedidoId;
  return typeof id === 'string' && UUID.test(id) ? id : null;
}

/**
 * Aviso por e-mail de que a exportação terminou (US-024, "por job e aviso"), na transação que grava
 * o resultado: o e-mail só sai se o resultado commitar. Pessoa inativa ou sem e-mail válido fica
 * sem aviso (a tela Minhas exportações mostra o resultado): registra no log e segue.
 */
async function avisar(tx: TxCliente, p: { id: string; usuarioId: string; titulo: string }, resultado: 'pronta' | 'falhou'): Promise<void> {
  const u = await tx.usuario.findUnique({ where: { id: p.usuarioId }, select: { nome: true, email: true, ativo: true } });
  if (!u?.ativo) return;
  const { urlPublica } = lerEnvAcesso();
  try {
    await enviarEmail(tx, 'exportacao.concluida', { email: u.email, nome: u.nome }, { nome: u.nome, titulo: p.titulo, resultado, urlAcesso: `${urlPublica}/rel/exportacoes` });
  } catch (erro) {
    if (!(erro instanceof ErroDominio)) throw erro;
    console.warn('[EXPORTACAO_AVISO_NAO_ENVIADO]', { pedido: p.id, codigo: erro.codigo });
  }
}

const textoDosErros = (erros: readonly ErroCampo[]) => erros.map((e) => e.mensagem).join(' ').slice(0, MAX_ERRO);

export type DepsTrabalhadorExportacao = {
  cliente: PrismaClient;
  geradores: Readonly<Record<string, GeradorExportacao>>;
  agora: () => Date;
};

/**
 * Trabalhador da fila exportacao.gerar. Pedido que não está pendente (já gerado, job repetido) é
 * ignorado. Falha da própria exportação (gerador ausente, filtros inválidos, acima do teto) marca o
 * pedido como FALHOU, sem nova tentativa; erro de infraestrutura sobe para a fila tentar de novo. O
 * Histórico registra a exportação quando o arquivo fica pronto, em nome de quem pediu. Pronta ou com
 * falha, quem pediu recebe o aviso por e-mail (avisar).
 */
export function criarTrabalhadorExportacao(deps: DepsTrabalhadorExportacao) {
  return async (dados: unknown): Promise<void> => {
    const pedidoId = lerPedidoId(dados);
    // Sem pedido válido, tentar de novo não adianta: registra e encerra o job.
    if (pedidoId === null) {
      console.error('[EXPORTACAO_JOB_INVALIDO]');
      return;
    }
    const resultado = await deps.cliente.$transaction(
      async (tx) => {
        // Trava a linha: dois jobs do mesmo pedido (reenvio) não geram duas vezes.
        const travado = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM exportacao_pedido WHERE id = ${pedidoId}::uuid AND situacao = 'PENDENTE' FOR UPDATE`;
        if (travado.length === 0) return 'ignorado' as const;
        const p = await tx.exportacaoPedido.findUniqueOrThrow({ where: { id: pedidoId }, omit: { conteudo: true } });
        const falhar = async (erros: readonly ErroCampo[]) => {
          await tx.exportacaoPedido.update({ where: { id: p.id }, data: { situacao: 'FALHOU', erro: textoDosErros(erros) || 'Falha na geração.', concluidoEm: deps.agora() }, select: { id: true } });
          await avisar(tx, p, 'falhou');
          return 'falhou' as const;
        };
        const gerador = Object.hasOwn(deps.geradores, p.funcionalidade) ? deps.geradores[p.funcionalidade] : undefined;
        if (!gerador) return falhar([{ campo: '_', mensagem: 'Esta listagem não tem exportação assíncrona.' }]);
        const c = await gerador(tx, p.parametros);
        if (!c.ok) return falhar(c.erros);
        const identificacao = criarIdentificacao({ titulo: p.titulo, filtros: c.valor.filtros, operador: p.usuarioRotulo }, deps.agora(), p.id);
        const planilha = { ...c.valor.planilha, identificacao };
        const opcoes = { limite: LIMITE_EXPORTACAO_ASSINCRONA };
        const arquivo = p.formato === 'xlsx' ? await exportarXlsx([planilha], opcoes) : exportarCsv(planilha, opcoes);
        if (!arquivo.ok) return falhar(arquivo.erros);
        const registros = planilha.linhas.length;
        await tx.exportacaoPedido.update({
          where: { id: p.id },
          data: { situacao: 'PRONTA', conteudo: new Uint8Array(arquivo.valor), registros, concluidoEm: deps.agora() },
          select: { id: true }, // sem RETURNING do arquivo
        });
        await auditar(tx, {
          contexto: { usuarioId: p.usuarioId, usuarioRotulo: p.usuarioRotulo, sessaoUid: p.sessaoUid, ip: p.ip, unidadeId: null },
          funcionalidade: p.funcionalidade,
          tipo: 'EXPORTACAO',
          registroId: p.id,
          descricao: `${p.titulo} exportado em ${p.formato.toUpperCase()} (rastreio ${p.id}, em segundo plano)`,
          depois: { formato: p.formato, registros, filtros: c.valor.filtros, rastreio: p.id, assincrona: true },
        });
        await avisar(tx, p, 'pronta');
        return 'pronta' as const;
      },
      { timeout: TEMPO_GERACAO_MS },
    );
    if (resultado === 'falhou') console.warn('[EXPORTACAO_FALHOU]', { pedido: pedidoId });
  };
}
