import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import type { TxCliente } from '@/shared/db';
import { ErroIA, type CodigoErroIA, type EsforcoIA, type EventoStreamIA, type PedidoIA, type ProvedorIA, type RespostaIA, type UsoIA } from './porta';
import { custoEmUnidades, unidadesParaUsd, usdParaUnidades } from './precos';

// Governança da IA (spec §4.4, US-019): o caminho dos módulos até a IA. Cada chamada passa, nesta
// ordem, pela permissão RBAC do caso de uso ("<funcionalidade>:executar"), pela chave geral
// (ia.habilitada) e pelo ativo do caso, pelo limite de chamadas por minuto da pessoa e pelo teto
// mensal de custo (do caso e global); depois vai ao provedor e fica no registro (ia_chamada), com
// sucesso ou erro. Tudo nasce desligado: a migration cria a chave geral desligada, e a seed instala o
// caso inativo e com teto zero. O teto é conferido antes da chamada: uma chamada em curso pode passar
// um pouco dele, e a seguinte já é recusada. IA sugere, não grava: nada aqui toca em dado oficial.

/** Um caso de uso de IA, declarado no código do módulo dono (a instrução é versionada como os modelos de e-mail). */
export type DefinicaoCasoUsoIA = {
  /** "<módulo>.<nome>", ex.: "cad.sugerir_conta". */
  codigo: string;
  nome: string;
  /** Funcionalidade do catálogo com a ação "executar": a permissão do caso. */
  funcionalidade: string;
  /** Sobe a cada mudança da instrução; vai para o registro de cada chamada. */
  versaoInstrucao: number;
  instrucaoSistema: string;
  /** Guarda o texto da entrada e da saída por 90 dias (ia_chamada_texto). Padrão: só o hash. */
  guardarTexto?: boolean;
};

/** Chamada do worker, sem pessoa: não confere permissão nem o limite por minuto. */
export const SISTEMA_IA = Object.freeze({ sistema: true as const });

/** Quem pede: a pessoa da requisição (o ContextoRequisicao serve) ou o Sistema. */
export type QuemPedeIA = { usuarioId: string; unidadeId?: string | null; permissoes: ReadonlySet<string> } | typeof SISTEMA_IA;

export interface ServicoIA {
  gerarTexto(quem: QuemPedeIA, caso: DefinicaoCasoUsoIA, mensagem: string, sinal?: AbortSignal): Promise<RespostaIA<string>>;
  gerarEstruturado<S extends z.ZodType>(quem: QuemPedeIA, caso: DefinicaoCasoUsoIA, mensagem: string, schema: S, sinal?: AbortSignal): Promise<RespostaIA<z.infer<S>>>;
  gerarStream(quem: QuemPedeIA, caso: DefinicaoCasoUsoIA, mensagem: string, sinal?: AbortSignal): AsyncIterable<EventoStreamIA>;
}

export type DependenciasServicoIA = {
  cliente: PrismaClient;
  obterProvedor: () => ProvedorIA;
  agora?: () => Date;
  relogio?: () => number;
};

export const DIAS_RETENCAO_TEXTO = 90;
const USO_ZERO: UsoIA = { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 };

type Caso = { modelo: string; esforco: string; maxTokens: number };
type Desfecho = { latenciaMs: number; modelo?: string | undefined; uso?: UsoIA | undefined; motivoParada?: string | undefined; erro?: CodigoErroIA; saida?: string };

export function criarServicoIA(d: DependenciasServicoIA): ServicoIA {
  const { cliente } = d;
  const agora = d.agora ?? (() => new Date());
  const relogio = d.relogio ?? (() => performance.now());
  // Um aviso de teto por escopo e mês, por processo: o log não repete a cada chamada recusada.
  const avisados = new Set<string>();

  async function liberar(quem: QuemPedeIA, def: DefinicaoCasoUsoIA): Promise<Caso> {
    const pessoa = 'sistema' in quem ? null : quem;
    if (pessoa && !pessoa.permissoes.has(`${def.funcionalidade}:executar`)) throw new ErroIA('ia.sem_permissao');
    const [config, caso] = await Promise.all([
      cliente.iaConfiguracao.findUnique({ where: { id: 1 } }),
      cliente.iaCasoUso.findUnique({ where: { codigo: def.codigo } }),
    ]);
    if (!caso) throw new Error(`caso de uso de IA não instalado: ${def.codigo}`);
    if (!config?.habilitada || !caso.ativo || config.tetoMensalUsd.isZero() || caso.tetoMensalUsd.isZero()) throw new ErroIA('ia.desligada');
    const momento = agora();
    if (pessoa) {
      const recentes = await cliente.iaChamada.count({ where: { usuarioId: pessoa.usuarioId, criadoEm: { gt: new Date(momento.getTime() - 60_000) } } });
      if (recentes >= config.limitePorMinuto) throw new ErroIA('ia.limite_usuario');
    }
    const desde = inicioDoMes(momento);
    const [doCaso, global] = await Promise.all([gastoDesde(desde, def.codigo), gastoDesde(desde)]);
    const estourado =
      doCaso >= usdParaUnidades(caso.tetoMensalUsd.toFixed(2)) ? def.codigo : global >= usdParaUnidades(config.tetoMensalUsd.toFixed(2)) ? 'global' : null;
    if (estourado) {
      const chave = `${estourado}:${desde.toISOString()}`;
      if (!avisados.has(chave)) {
        avisados.add(chave);
        console.warn('[IA_TETO_ATINGIDO]', { escopo: estourado, desde: desde.toISOString() });
      }
      throw new ErroIA('ia.teto_atingido');
    }
    return caso;
  }

  async function gastoDesde(desde: Date, casoUsoCodigo?: string): Promise<bigint> {
    const r = await cliente.iaChamada.aggregate({
      _sum: { custoEstimadoUsd: true },
      where: { criadoEm: { gte: desde }, ...(casoUsoCodigo ? { casoUsoCodigo } : {}) },
    });
    // toFixed, e não toString: o decimal.js escreve valores pequenos em notação científica.
    return usdParaUnidades(r._sum.custoEstimadoUsd?.toFixed(8) ?? '0');
  }

  async function registrar(quem: QuemPedeIA, def: DefinicaoCasoUsoIA, caso: Caso, mensagem: string, x: Desfecho): Promise<void> {
    const uso = x.uso ?? USO_ZERO;
    const pessoa = 'sistema' in quem ? null : quem;
    try {
      await cliente.$transaction(async (tx) => {
        const { id } = await tx.iaChamada.create({
          data: {
            casoUsoCodigo: def.codigo,
            versaoInstrucao: def.versaoInstrucao,
            usuarioId: pessoa?.usuarioId ?? null,
            unidadeId: pessoa?.unidadeId ?? null,
            modelo: caso.modelo,
            modeloResposta: x.modelo ?? null,
            tokensEntrada: uso.entrada,
            tokensSaida: uso.saida,
            tokensCacheLeitura: uso.cacheLeitura,
            tokensCacheEscrita: uso.cacheEscrita,
            custoEstimadoUsd: unidadesParaUsd(custoEmUnidades(x.modelo ?? caso.modelo, uso)),
            latenciaMs: Math.max(0, Math.round(x.latenciaMs)),
            motivoParada: x.motivoParada ?? null,
            erro: x.erro ?? null,
            hashEntrada: hashEntrada(def, mensagem),
          },
          select: { id: true },
        });
        if (def.guardarTexto) await tx.iaChamadaTexto.create({ data: { chamadaId: id, entrada: mensagem, saida: x.saida ?? null } });
      });
    } catch (e) {
      // O registro não desfaz a resposta já paga; a falha fica no log (sem o texto).
      console.error('[IA_REGISTRO_FALHOU]', { caso: def.codigo, erro: e instanceof Error ? e.message : String(e) });
    }
  }

  const pedido = (def: DefinicaoCasoUsoIA, caso: Caso, mensagem: string, sinal?: AbortSignal): PedidoIA => ({
    instrucaoSistema: def.instrucaoSistema,
    mensagem,
    modelo: caso.modelo,
    // O CHECK do banco só aceita os esforços da porta.
    esforco: caso.esforco as EsforcoIA,
    maxTokens: caso.maxTokens,
    ...(sinal ? { sinal } : {}),
  });

  const falhou = (e: unknown, inicio: number): Desfecho => {
    const erro = e instanceof ErroIA ? e : null;
    return { latenciaMs: relogio() - inicio, modelo: erro?.detalhes.modelo, uso: erro?.detalhes.uso, erro: erro?.codigo ?? 'ia.indisponivel' };
  };

  async function chamar<T>(quem: QuemPedeIA, def: DefinicaoCasoUsoIA, mensagem: string, fazer: (p: PedidoIA) => Promise<RespostaIA<T>>, sinal?: AbortSignal) {
    const caso = await liberar(quem, def);
    const inicio = relogio();
    try {
      const r = await fazer(pedido(def, caso, mensagem, sinal));
      const saida = typeof r.valor === 'string' ? r.valor : JSON.stringify(r.valor);
      await registrar(quem, def, caso, mensagem, { latenciaMs: r.latenciaMs, modelo: r.modelo, uso: r.uso, motivoParada: r.motivoParada, saida });
      return r;
    } catch (e) {
      await registrar(quem, def, caso, mensagem, falhou(e, inicio));
      throw e;
    }
  }

  return {
    gerarTexto: (quem, def, mensagem, sinal) => chamar(quem, def, mensagem, (p) => d.obterProvedor().gerarTexto(p), sinal),
    gerarEstruturado: (quem, def, mensagem, schema, sinal) => chamar(quem, def, mensagem, (p) => d.obterProvedor().gerarEstruturado(p, schema), sinal),

    async *gerarStream(quem, def, mensagem, sinal) {
      const caso = await liberar(quem, def);
      const inicio = relogio();
      let fim: RespostaIA<string> | null = null;
      let falha: unknown = null;
      try {
        for await (const ev of d.obterProvedor().gerarStream(pedido(def, caso, mensagem, sinal))) {
          if (ev.tipo === 'fim') fim = ev.resposta;
          yield ev;
        }
      } catch (e) {
        falha = e;
        throw e;
      } finally {
        // Sem o fim e sem erro: quem consumia parou no meio (saiu da tela); conta como cancelada.
        await registrar(
          quem,
          def,
          caso,
          mensagem,
          fim
            ? { latenciaMs: fim.latenciaMs, modelo: fim.modelo, uso: fim.uso, motivoParada: fim.motivoParada, saida: fim.valor }
            : falha
              ? falhou(falha, inicio)
              : { latenciaMs: relogio() - inicio, erro: 'ia.cancelada' },
        );
      }
    },
  };
}

/** Hash da entrada (caso, versão, instrução e mensagem): mostra repetições sem guardar o texto. */
function hashEntrada(def: DefinicaoCasoUsoIA, mensagem: string): string {
  return createHash('sha256').update(JSON.stringify([def.codigo, def.versaoInstrucao, def.instrucaoSistema, mensagem])).digest('hex');
}

/** Início do mês em America/Sao_Paulo, sem horário de verão desde 2019: UTC-3 fixo. */
export function inicioDoMes(agora: Date): Date {
  const local = new Date(agora.getTime() - 3 * 3_600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1, 3));
}

const CODIGO_CASO = /^[a-z]+\.[a-z0-9_]+$/;

/**
 * Instala os casos de uso na seed do módulo dono: o caso novo entra inativo e com teto zero; nos já
 * instalados, atualiza só o que vem do código (nome, funcionalidade, versão e guardarTexto), sem
 * mexer na configuração da tela. A funcionalidade precisa existir com a ação "executar".
 */
export async function instalarCasosUsoIA(tx: TxCliente, casos: readonly DefinicaoCasoUsoIA[]): Promise<void> {
  for (const c of casos) {
    if (!CODIGO_CASO.test(c.codigo) || !Number.isInteger(c.versaoInstrucao) || c.versaoInstrucao < 1) throw new Error(`caso de uso de IA inválido: ${c.codigo}`);
    const f = await tx.funcionalidade.findUnique({ where: { codigo: c.funcionalidade }, select: { acoes: true } });
    if (!f?.acoes.includes('executar')) throw new Error(`caso de uso de IA ${c.codigo}: a funcionalidade ${c.funcionalidade} não existe ou não tem a ação "executar"`);
    const doCodigo = { nome: c.nome, funcionalidade: c.funcionalidade, versaoInstrucao: c.versaoInstrucao, guardarTexto: c.guardarTexto ?? false };
    await tx.iaCasoUso.upsert({ where: { codigo: c.codigo }, create: { codigo: c.codigo, ...doCodigo }, update: doCodigo });
  }
}

/** Retenção (spec §4.4): apaga o texto completo das chamadas com mais de 90 dias; o registro fica. */
export async function limparTextosIA(cliente: PrismaClient, agora: Date): Promise<number> {
  const limite = new Date(agora.getTime() - DIAS_RETENCAO_TEXTO * 86_400_000);
  const { count } = await cliente.iaChamadaTexto.deleteMany({ where: { criadoEm: { lt: limite } } });
  return count;
}
