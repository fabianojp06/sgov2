import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import type { TxCliente } from '@/shared/db';
import { ErroIA, type CodigoErroIA, type EsforcoIA, type EventoStreamIA, type PedidoIA, type ProvedorIA, type RespostaIA, type UsoIA } from './porta';
import { custoEmUnidades, MODELOS_IA, unidadesParaUsd, usdParaUnidades } from './precos';

// Governança da IA (spec §4.4, US-019): o caminho dos módulos até a IA. Cada chamada passa, nesta
// ordem, pela permissão RBAC do caso de uso ("<funcionalidade>:executar"), pela chave geral
// (ia.habilitada) e pelo ativo do caso, pelo limite de chamadas por minuto da pessoa e pelo teto
// mensal de custo (do caso e global); depois vai ao provedor e fica no registro (ia_chamada), com
// sucesso ou erro. Tudo nasce desligado: a migration cria a chave geral desligada, e a seed instala o
// caso inativo e com teto zero. IA sugere, não grava: nada aqui toca em dado oficial.
//
// Chamadas simultâneas: antes do provedor, a chamada entra em ia_reserva com o custo máximo estimado,
// sob uma trava do banco; o limite por minuto e o teto contam as reservas abertas com as chamadas
// registradas. Assim, N pedidos em paralelo não passam todos pela mesma conferência. O excesso sobre o
// teto fica limitado a uma chamada em curso (a que passa dele entra; a seguinte já é recusada).

/** Um caso de uso de IA, declarado no código do módulo dono (a instrução é versionada como os modelos de e-mail). */
export type DefinicaoCasoUsoIA = {
  /** "<módulo>.<nome>", ex.: "cad.sugerir_conta". */
  codigo: string;
  nome: string;
  /** Funcionalidade do catálogo com a ação "executar": a permissão própria do caso (uma por caso). */
  funcionalidade: string;
  /** Sobe a cada mudança da instrução; vai para o registro de cada chamada. */
  versaoInstrucao: number;
  instrucaoSistema: string;
  /** Guarda o texto da entrada e da saída por 90 dias (ia_chamada_texto). Padrão: só o hash. */
  guardarTexto?: boolean;
  /** Configuração inicial, só na primeira instalação; depois vale a da tela de cadastro. */
  padrao?: { modelo?: string; esforco?: EsforcoIA; maxTokens?: number };
};

/**
 * Chamada do worker, sem pessoa: não confere permissão nem o limite por minuto (chaves e tetos
 * valem). Só nos trabalhadores de fila: o teste de fronteira recusa o uso numa tela ou Server Action.
 */
export const SISTEMA_IA = Object.freeze({ sistema: true as const });

/** Quem pede: a pessoa da requisição (o ContextoRequisicao serve) ou o Sistema. */
export type QuemPedeIA = { usuarioId: string; unidadeId?: string | null; permissoes: ReadonlySet<string> } | typeof SISTEMA_IA;

export interface ServicoIA {
  /**
   * Se o caso responderia agora a quem pede: permissão, chave geral, caso ativo e tetos definidos e não
   * atingidos. Não reserva nem registra; o limite por minuto fica de fora (é passageiro). Para a tela
   * mostrar ou esconder o botão; a chamada confere tudo de novo.
   */
  disponivel(quem: QuemPedeIA, caso: DefinicaoCasoUsoIA): Promise<boolean>;
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
// Reserva aberta há mais que isto é de um processo que caiu: deixa de contar. Cobre o tempo limite
// do adaptador (2 min por tentativa, 4 tentativas) com folga.
export const MINUTOS_RESERVA = 15;
const USO_ZERO: UsoIA = { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 };
// Recusados pela API antes de gerar (pedido inválido, credencial): não custam nada.
const SEM_CUSTO: ReadonlySet<CodigoErroIA> = new Set(['ia.requisicao_invalida', 'ia.autenticacao']);

type Caso = { modelo: string; esforco: string; maxTokens: number };
type Liberada = { caso: Caso; reservaId: string; estimativa: UsoIA };
type Desfecho = { latenciaMs: number; modelo?: string | undefined; uso?: UsoIA | undefined; motivoParada?: string | undefined; erro?: CodigoErroIA; saida?: string };

export function criarServicoIA(d: DependenciasServicoIA): ServicoIA {
  const { cliente } = d;
  const agora = d.agora ?? (() => new Date());
  const relogio = d.relogio ?? (() => performance.now());
  // Um aviso de teto por escopo e mês, por processo: o log não repete a cada chamada recusada.
  const avisados = new Set<string>();

  const pessoaDe = (quem: QuemPedeIA) => ('sistema' in quem ? null : quem);
  const permitido = (quem: QuemPedeIA, def: DefinicaoCasoUsoIA) => {
    const pessoa = pessoaDe(quem);
    return !pessoa || pessoa.permissoes.has(`${def.funcionalidade}:executar`);
  };

  /** A configuração e o caso, se a IA está ligada para ele (chave geral, caso ativo e tetos definidos); senão, null. */
  async function ligado(def: DefinicaoCasoUsoIA) {
    const [config, caso] = await Promise.all([
      cliente.iaConfiguracao.findUnique({ where: { id: 1 } }),
      cliente.iaCasoUso.findUnique({ where: { codigo: def.codigo } }),
    ]);
    if (!caso) throw new Error(`caso de uso de IA não instalado: ${def.codigo}`);
    if (!config?.habilitada || !caso.ativo || config.tetoMensalUsd.isZero() || caso.tetoMensalUsd.isZero()) return null;
    return { config, caso };
  }

  /** O escopo do teto atingido (o código do caso ou "global"), contando as reservas abertas; senão, null. */
  async function tetoEstourado(tx: TxCliente, def: DefinicaoCasoUsoIA, l: NonNullable<Awaited<ReturnType<typeof ligado>>>, momento: Date): Promise<string | null> {
    const desde = inicioDoMes(momento);
    const reservasDesde = new Date(momento.getTime() - MINUTOS_RESERVA * 60_000);
    const [doCaso, global] = await Promise.all([gasto(tx, desde, reservasDesde, def.codigo), gasto(tx, desde, reservasDesde)]);
    if (doCaso >= usdParaUnidades(l.caso.tetoMensalUsd.toFixed(2))) return def.codigo;
    return global >= usdParaUnidades(l.config.tetoMensalUsd.toFixed(2)) ? 'global' : null;
  }

  async function liberar(quem: QuemPedeIA, def: DefinicaoCasoUsoIA, mensagem: string): Promise<Liberada> {
    const pessoa = pessoaDe(quem);
    if (!permitido(quem, def)) throw new ErroIA('ia.sem_permissao');
    const l = await ligado(def);
    if (!l) throw new ErroIA('ia.desligada');
    const { config, caso } = l;
    // Teto superior do gasto: cada token tem ao menos um caractere, e a saída não passa do max_tokens.
    const estimativa: UsoIA = { ...USO_ZERO, entrada: def.instrucaoSistema.length + mensagem.length, saida: caso.maxTokens };
    const momento = agora();
    const desde = inicioDoMes(momento);
    const reservasDesde = new Date(momento.getTime() - MINUTOS_RESERVA * 60_000);

    const reservaId = await cliente.$transaction(async (tx) => {
      // Uma conferência por vez em todo o sistema (é curta): as reservas tornam a contagem exata.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('sgo.ia.reserva'))::text`;
      if (pessoa) {
        const [feitas, abertas] = await Promise.all([
          tx.iaChamada.count({ where: { usuarioId: pessoa.usuarioId, criadoEm: { gt: new Date(momento.getTime() - 60_000) } } }),
          tx.iaReserva.count({ where: { usuarioId: pessoa.usuarioId, criadoEm: { gt: reservasDesde } } }),
        ]);
        if (feitas + abertas >= config.limitePorMinuto) throw new ErroIA('ia.limite_usuario');
      }
      const estourado = await tetoEstourado(tx, def, l, momento);
      if (estourado) {
        const chave = `${estourado}:${desde.toISOString()}`;
        if (!avisados.has(chave)) {
          avisados.add(chave);
          console.warn('[IA_TETO_ATINGIDO]', { escopo: estourado, desde: desde.toISOString() });
        }
        throw new ErroIA('ia.teto_atingido');
      }
      const { id } = await tx.iaReserva.create({
        data: { casoUsoCodigo: def.codigo, usuarioId: pessoa?.usuarioId ?? null, custoMaximoUsd: unidadesParaUsd(custoEmUnidades(caso.modelo, estimativa)) },
        select: { id: true },
      });
      return id;
    });
    return { caso, reservaId, estimativa };
  }

  /** Gasto do mês (chamadas registradas) mais o custo máximo das reservas abertas. */
  async function gasto(tx: TxCliente, desde: Date, reservasDesde: Date, casoUsoCodigo?: string): Promise<bigint> {
    const doCaso = casoUsoCodigo ? { casoUsoCodigo } : {};
    const [feitas, abertas] = await Promise.all([
      tx.iaChamada.aggregate({ _sum: { custoEstimadoUsd: true }, where: { criadoEm: { gte: desde }, ...doCaso } }),
      tx.iaReserva.aggregate({ _sum: { custoMaximoUsd: true }, where: { criadoEm: { gt: reservasDesde }, ...doCaso } }),
    ]);
    // toFixed, e não toString: o decimal.js escreve valores pequenos em notação científica.
    return usdParaUnidades(feitas._sum.custoEstimadoUsd?.toFixed(8) ?? '0') + usdParaUnidades(abertas._sum.custoMaximoUsd?.toFixed(8) ?? '0');
  }

  async function registrar(quem: QuemPedeIA, def: DefinicaoCasoUsoIA, l: Liberada, mensagem: string, x: Desfecho): Promise<void> {
    const pessoa = 'sistema' in quem ? null : quem;
    try {
      // Produção sem chave: nada chegou a um provedor; só libera a reserva.
      if (x.erro === 'ia.desabilitada') return;
      // Sem o uso real (tempo esgotado, stream interrompido): a estimativa da reserva, que erra para cima.
      const uso = x.uso ?? (x.erro && SEM_CUSTO.has(x.erro) ? USO_ZERO : l.estimativa);
      // Com fallback, parte veio do modelo pedido e parte do outro: o preço maior dos dois.
      const custo = [l.caso.modelo, x.modelo ?? l.caso.modelo].map((m) => custoEmUnidades(m, uso)).reduce((a, b) => (a > b ? a : b));
      let id: string;
      try {
        ({ id } = await cliente.iaChamada.create({
          data: {
            casoUsoCodigo: def.codigo,
            versaoInstrucao: def.versaoInstrucao,
            usuarioId: pessoa?.usuarioId ?? null,
            unidadeId: pessoa?.unidadeId ?? null,
            modelo: l.caso.modelo,
            modeloResposta: x.modelo ?? null,
            tokensEntrada: uso.entrada,
            tokensSaida: uso.saida,
            tokensCacheLeitura: uso.cacheLeitura,
            tokensCacheEscrita: uso.cacheEscrita,
            custoEstimadoUsd: unidadesParaUsd(custo),
            latenciaMs: Math.max(0, Math.round(x.latenciaMs)),
            motivoParada: x.motivoParada ?? null,
            erro: x.erro ?? null,
            hashEntrada: hashEntrada(def, mensagem),
          },
          select: { id: true },
        }));
      } catch (e) {
        // O registro não desfaz a resposta já paga; a falha fica no log (sem o texto).
        console.error('[IA_REGISTRO_FALHOU]', { caso: def.codigo, ...resumoErro(e) });
        return;
      }
      // O texto à parte: se ele falhar, o registro (e o custo no teto) fica.
      if (def.guardarTexto) {
        await cliente.iaChamadaTexto
          .create({ data: { chamadaId: id, entrada: semNulo(mensagem), saida: x.saida === undefined ? null : semNulo(x.saida) } })
          .catch((e: unknown) => console.error('[IA_TEXTO_NAO_GUARDADO]', { caso: def.codigo, ...resumoErro(e) }));
      }
    } finally {
      await cliente.iaReserva.delete({ where: { id: l.reservaId } }).catch((e: unknown) => console.error('[IA_RESERVA_NAO_LIBERADA]', resumoErro(e)));
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
    const l = await liberar(quem, def, mensagem);
    const inicio = relogio();
    try {
      const r = await fazer(pedido(def, l.caso, mensagem, sinal));
      const saida = typeof r.valor === 'string' ? r.valor : JSON.stringify(r.valor);
      await registrar(quem, def, l, mensagem, { latenciaMs: r.latenciaMs, modelo: r.modelo, uso: r.uso, motivoParada: r.motivoParada, saida });
      return r;
    } catch (e) {
      await registrar(quem, def, l, mensagem, falhou(e, inicio));
      throw e;
    }
  }

  return {
    async disponivel(quem, def) {
      if (!permitido(quem, def)) return false;
      const l = await ligado(def);
      return l !== null && (await tetoEstourado(cliente, def, l, agora())) === null;
    },
    gerarTexto: (quem, def, mensagem, sinal) => chamar(quem, def, mensagem, (p) => d.obterProvedor().gerarTexto(p), sinal),
    gerarEstruturado: (quem, def, mensagem, schema, sinal) => chamar(quem, def, mensagem, (p) => d.obterProvedor().gerarEstruturado(p, schema), sinal),

    async *gerarStream(quem, def, mensagem, sinal) {
      const l = await liberar(quem, def, mensagem);
      const inicio = relogio();
      let fim: RespostaIA<string> | null = null;
      let falha: unknown = null;
      try {
        for await (const ev of d.obterProvedor().gerarStream(pedido(def, l.caso, mensagem, sinal))) {
          if (ev.tipo === 'fim') fim = ev.resposta;
          yield ev;
        }
      } catch (e) {
        falha = e;
        throw e;
      } finally {
        // Sem o fim e sem erro: quem consumia parou no meio (saiu da tela); conta como cancelada, com o
        // custo estimado (o provedor cobra o que já gerou).
        await registrar(
          quem,
          def,
          l,
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

// O PostgreSQL não aceita o caractere nulo em TEXT.
const semNulo = (t: string) => t.replaceAll('\u0000', '');

// Só o tipo e o código: a mensagem de erro do Prisma pode trazer os argumentos (o texto da chamada).
function resumoErro(e: unknown): { nome: string; codigo?: string } {
  if (!(e instanceof Error)) return { nome: typeof e };
  const codigo = (e as { code?: unknown }).code;
  return typeof codigo === 'string' ? { nome: e.name, codigo } : { nome: e.name };
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
 * mexer na configuração da tela. A funcionalidade precisa existir com a ação "executar" e é só do
 * caso (o banco recusa duas iguais).
 */
export async function instalarCasosUsoIA(tx: TxCliente, casos: readonly DefinicaoCasoUsoIA[]): Promise<void> {
  for (const c of casos) {
    if (!CODIGO_CASO.test(c.codigo) || !Number.isInteger(c.versaoInstrucao) || c.versaoInstrucao < 1) throw new Error(`caso de uso de IA inválido: ${c.codigo}`);
    const f = await tx.funcionalidade.findUnique({ where: { codigo: c.funcionalidade }, select: { acoes: true } });
    if (!f?.acoes.includes('executar')) throw new Error(`caso de uso de IA ${c.codigo}: a funcionalidade ${c.funcionalidade} não existe ou não tem a ação "executar"`);
    const p = c.padrao ?? {};
    if (p.modelo !== undefined && !MODELOS_IA.includes(p.modelo)) throw new Error(`caso de uso de IA ${c.codigo}: modelo fora da tabela de preços: ${p.modelo}`);
    if (p.maxTokens !== undefined && !(Number.isInteger(p.maxTokens) && p.maxTokens >= 1 && p.maxTokens <= 128_000)) throw new Error(`caso de uso de IA ${c.codigo}: maxTokens inválido`);
    const doCodigo = { nome: c.nome, funcionalidade: c.funcionalidade, versaoInstrucao: c.versaoInstrucao, guardarTexto: c.guardarTexto ?? false };
    const inicial = { ...(p.modelo ? { modelo: p.modelo } : {}), ...(p.esforco ? { esforco: p.esforco } : {}), ...(p.maxTokens ? { maxTokens: p.maxTokens } : {}) };
    await tx.iaCasoUso.upsert({ where: { codigo: c.codigo }, create: { codigo: c.codigo, ...doCodigo, ...inicial }, update: doCodigo });
  }
}

/**
 * Limpeza do worker: o texto completo das chamadas com mais de 90 dias (spec §4.4; o registro fica) e
 * as reservas de processos que caíram.
 */
export async function limparIA(cliente: PrismaClient, agora: Date): Promise<{ textos: number; reservas: number }> {
  const [textos, reservas] = await Promise.all([
    cliente.iaChamadaTexto.deleteMany({ where: { criadoEm: { lt: new Date(agora.getTime() - DIAS_RETENCAO_TEXTO * 86_400_000) } } }),
    cliente.iaReserva.deleteMany({ where: { criadoEm: { lt: new Date(agora.getTime() - MINUTOS_RESERVA * 60_000) } } }),
  ]);
  return { textos: textos.count, reservas: reservas.count };
}
