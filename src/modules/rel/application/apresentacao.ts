import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma, type TxCliente } from '@/shared/db';
import { ErroIA, servicoIA, type ServicoIA } from '@/shared/ia';
import { falha, ok, type Resultado } from '@/shared/kernel';
import { conferirRoteiro, ESQUEMA_ROTEIRO, MAXIMO_NOTAS, MAXIMO_TITULO, MAXIMO_TOPICO, mensagemApresentacao, validarTema, type Roteiro } from '../domain/apresentacao';
import { dataEmBrasilia, mesEmBrasilia, type DadosRelatorio } from '../domain/relatorio-executivo';
import { CASO_APRESENTACAO } from './ia-casos';
import { LER_ADM_CENTRAL, LER_TPS, type LerAdmCentral, type LerTps } from './relatorio-executivo';

// Roteiro de apresentação para reunião de diretoria (US-105, IA-15). Sem tabela: o roteiro volta para a
// tela, a GFIN confere e baixa os slides em PDF. Os dados (agregados da Adm. Central e dos TPs, os mesmos
// do relatório executivo, US-103, com as mesmas regras) são lidos de novo no servidor ao gerar o PDF;
// do navegador só vem o roteiro, validado de forma estrita. Nada é gravado além da chamada à IA
// (ia_chamada) e da EXPORTACAO no Histórico.

export const FUNCIONALIDADE_APRESENTACAO = 'rel.apresentacao_diretoria';
export const TEMPO_LIMITE_APRESENTACAO_MS = 90_000;

export const MENSAGENS_APRESENTACAO = {
  SEM_DADOS: 'O seu perfil não consulta a Administração Central nem o Consolidado dos TPs: não há dado para a apresentação.',
  ROTEIRO_INVALIDO: 'O roteiro veio inválido. Gere de novo.',
  TEMPO_ESGOTADO: 'A IA demorou demais para responder. Tente de novo.',
  SEM_SLIDES: 'A IA não montou nenhum slide. Reformule o tema e tente de novo.',
} as const;

const SAIDA = z.object({
  // Sem teto no número de slides e de tópicos: a conferência corta.
  slides: z.array(
    z.object({
      titulo: z.string().max(MAXIMO_TITULO * 2),
      topicos: z.array(z.string().max(MAXIMO_TOPICO * 2)),
      grafico: z.string().max(40),
      notas: z.string().max(MAXIMO_NOTAS * 2),
    }),
  ),
});

export type DepsApresentacao = {
  cliente: PrismaClient;
  ia: ServicoIA;
  sinalIa: () => AbortSignal;
  agora: () => Date;
  lerAdmCentral: LerAdmCentral;
  lerTps: LerTps;
};
const resolver = (d: Partial<DepsApresentacao>): DepsApresentacao => ({
  cliente: d.cliente ?? prisma,
  ia: d.ia ?? servicoIA,
  sinalIa: d.sinalIa ?? (() => AbortSignal.timeout(TEMPO_LIMITE_APRESENTACAO_MS)),
  agora: d.agora ?? (() => new Date()),
  lerAdmCentral: d.lerAdmCentral ?? LER_ADM_CENTRAL,
  lerTps: d.lerTps ?? LER_TPS,
});

const erro = (mensagem: string, campo = '_'): Resultado<never> => falha([{ campo, mensagem }]);
const tempoEsgotado = (sinal: AbortSignal) => sinal.aborted && (sinal.reason as { name?: unknown } | undefined)?.name === 'TimeoutError';
const contextoDe = (ctx: ContextoRequisicao) => ({ usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip, unidadeId: null });

async function lerDados(ctx: ContextoRequisicao, deps: DepsApresentacao): Promise<DadosRelatorio | null> {
  const mes = mesEmBrasilia(deps.agora());
  const [admCentral, tps] = await Promise.all([deps.lerAdmCentral(ctx, Number(mes.slice(0, 4))), deps.lerTps(ctx)]);
  if (!admCentral && !tps) return null;
  return { mes, admCentral, tps: tps?.tps ?? null, tpsOmitidos: tps?.omitidos ?? 0 };
}

/** O campo do tema aparece? A permissão do caso, a chave geral, o caso ativo e os tetos. */
export function apresentacaoLiberada(ctx: ContextoRequisicao, deps: Partial<Pick<DepsApresentacao, 'ia'>> = {}): Promise<boolean> {
  return (deps.ia ?? servicoIA).disponivel(ctx, CASO_APRESENTACAO);
}

export async function gerarRoteiro(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsApresentacao> = {}): Promise<Resultado<{ tema: string; roteiro: Roteiro }>> {
  if (!ctx.permissoes.has(`${FUNCIONALIDADE_APRESENTACAO}:executar`)) return erro(new ErroIA('ia.sem_permissao').message);
  const tema = validarTema((bruto as { tema?: unknown } | null)?.tema);
  if (!tema.ok) return tema;
  const deps = resolver(depsParciais);
  // Caso desligado ou teto estourado: recusa antes da leitura (a dos TPs grava a CONSULTA no Histórico).
  if (!(await deps.ia.disponivel(ctx, CASO_APRESENTACAO))) return erro(new ErroIA('ia.desligada').message);
  const dados = await lerDados(ctx, deps);
  if (!dados) return erro(MENSAGENS_APRESENTACAO.SEM_DADOS);
  const sinal = deps.sinalIa();
  try {
    const r = await deps.ia.gerarEstruturado(ctx, CASO_APRESENTACAO, mensagemApresentacao(tema.valor, dados), SAIDA, sinal);
    const roteiro = conferirRoteiro(r.valor, dados);
    if (roteiro.slides.length === 0) return erro(MENSAGENS_APRESENTACAO.SEM_SLIDES);
    return ok({ tema: tema.valor, roteiro });
  } catch (x) {
    if (!(x instanceof ErroIA)) throw x;
    return erro(x.codigo === 'ia.cancelada' && tempoEsgotado(sinal) ? MENSAGENS_APRESENTACAO.TEMPO_ESGOTADO : x.message);
  }
}

/** Os slides em PDF (16:9): o roteiro vem do navegador (validado), os dados são relidos aqui. */
export async function exportarSlides(
  ctx: ContextoRequisicao,
  bruto: unknown,
  depsParciais: Partial<DepsApresentacao> = {},
): Promise<Resultado<{ nome: string; base64: string }>> {
  exigir(ctx, FUNCIONALIDADE_APRESENTACAO, 'exportar');
  const e = bruto as { tema?: unknown; roteiro?: unknown } | null;
  const tema = validarTema(e?.tema);
  if (!tema.ok) return tema;
  const roteiro = ESQUEMA_ROTEIRO.safeParse(e?.roteiro);
  if (!roteiro.success) return erro(MENSAGENS_APRESENTACAO.ROTEIRO_INVALIDO);
  const deps = resolver(depsParciais);
  const dados = await lerDados(ctx, deps);
  if (!dados) return erro(MENSAGENS_APRESENTACAO.SEM_DADOS);
  // Gráfico que os dados de agora não permitem vira NENHUM (como na geração).
  const conferido = conferirRoteiro(roteiro.data, dados);
  const { gerarPdfApresentacao } = await import('../infrastructure/pdf-apresentacao');
  const agora = deps.agora();
  const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(agora);
  const bytes = await gerarPdfApresentacao(tema.valor, conferido, dados, ctx.usuarioRotulo, `${dataEmBrasilia(agora)} às ${hora}`);
  // O roteiro vem do navegador: o Histórico guarda o tema e o hash do que foi exportado (revisão 12.12).
  const hash = createHash('sha256').update(JSON.stringify(conferido)).digest('hex');
  await deps.cliente.$transaction(async (tx: TxCliente) => {
    await auditar(tx, {
      contexto: contextoDe(ctx),
      funcionalidade: FUNCIONALIDADE_APRESENTACAO,
      tipo: 'EXPORTACAO',
      descricao: `Slides da apresentação exportados em PDF (${conferido.slides.length} slides)`,
      depois: { tema: tema.valor, slides: conferido.slides.length, roteiroSha256: hash },
    });
  });
  return ok({ nome: `apresentacao-${dados.mes}.pdf`, base64: Buffer.from(bytes).toString('base64') });
}

