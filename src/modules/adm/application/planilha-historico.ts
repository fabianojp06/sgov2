import type { Prisma } from '@/generated/prisma/client';
import type { FiltroExportacao } from '@/modules/ger';
import { LIMITE_EXPORTACAO_ASSINCRONA, type ConteudoExportacao, type GeradorExportacao } from '@/modules/ger/servidor';
import { TIPOS_OPERACAO, type TipoOperacao } from '@/shared/audit';
import type { TxCliente } from '@/shared/db';
import { falha, ok, type Resultado } from '@/shared/kernel';
import { carregarPermissoes } from './login';

// O alcance, os filtros e o conteúdo da exportação do Histórico (US-040, Task 7; US-024): usados na
// consulta e na exportação da tela (historico.ts) e pelo worker (exportação assíncrona, pelo
// servidor.ts). Sem server-only nem @/shared/authz: o gerador roda no worker, sem sessão, e por isso
// reaplica as regras da tela para quem pediu, no momento da geração (D-P8-8/9).
export type FiltroHistorico = { usuario?: string; funcionalidade?: string; tipo?: TipoOperacao; de: Date; ate: Date; pagina: number };

export const FUNCIONALIDADE_HISTORICO = 'adm.historico';
export const TITULO_HISTORICO = 'Histórico de Operações';
const PERIODO_MAXIMO_MS = 366 * 24 * 60 * 60 * 1000;
// [PROVISÓRIO]
export const MENSAGEM_PERIODO = 'O período pode ter no máximo 366 dias, com a data inicial antes da final.';
export const MENSAGEM_USUARIO_FILTRO = 'O filtro de usuário pode ter no máximo 120 caracteres.';
// [PROVISÓRIO] Quem pediu perdeu o exportar (ou foi inativado) antes de o worker gerar o arquivo.
export const MENSAGEM_SEM_PERMISSAO_EXPORTAR = 'Você não tem mais permissão para exportar o Histórico.';
export const MENSAGEM_PEDIDO_INVALIDO = 'Pedido de exportação inválido.';
const MAXIMO_USUARIO = 120;
const CODIGO = /^[a-z]{3}\.[a-z0-9_]{1,57}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const escaparLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

async function ehAdministrador(tx: TxCliente, usuarioId: string): Promise<boolean> {
  return (await tx.usuarioPerfil.count({ where: { usuarioId, perfil: { codigo: 'ADMINISTRADOR', ativo: true } } })) > 0;
}

// O `where` da consulta e da exportação (US-040, Task 7): o Administrador vê tudo; os outros perfis,
// só as funcionalidades do próprio perfil (RN0099), nunca os registros fora do catálogo (RN0100).
export async function filtroDoHistorico(usuarioId: string, f: Omit<FiltroHistorico, 'pagina'>, tx: TxCliente): Promise<Prisma.HistoricoOperacaoWhereInput> {
  const alcance = (await ehAdministrador(tx, usuarioId))
    ? {}
    : { funcionalidade: { in: [...new Set([...(await carregarPermissoes(tx, usuarioId))].map((p) => p.split(':')[0]!))] } };
  return {
    AND: [
      alcance,
      { ocorridoEm: { gte: f.de, lte: f.ate } },
      ...(f.funcionalidade ? [{ funcionalidade: f.funcionalidade }] : []),
      ...(f.tipo ? [{ tipoOperacao: f.tipo }] : []),
      ...(f.usuario ? [{ usuarioRotulo: { contains: escaparLike(f.usuario), mode: 'insensitive' as const } }] : []),
    ],
  };
}

export function periodoValido(f: Pick<FiltroHistorico, 'de' | 'ate'>): boolean {
  if (Number.isNaN(f.de.getTime()) || Number.isNaN(f.ate.getTime())) return false;
  return f.de.getTime() <= f.ate.getTime() && f.ate.getTime() - f.de.getTime() <= PERIODO_MAXIMO_MS;
}

/** O período e o filtro de usuário, conferidos igual na consulta, na exportação e no worker. */
export function validarFiltroHistorico(f: Omit<FiltroHistorico, 'pagina'>): Resultado<void> {
  if (!periodoValido(f)) return falha([{ campo: 'de', mensagem: MENSAGEM_PERIODO }]);
  if ((f.usuario?.length ?? 0) > MAXIMO_USUARIO) return falha([{ campo: 'usuario', mensagem: MENSAGEM_USUARIO_FILTRO }]);
  return ok(undefined);
}

// Dia civil em Brasília (en-CA formata como AAAA-MM-DD): o fim do dia de 04/11 é 05/11 em UTC.
const DIA_BRASILIA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });
export const diaBrasilia = (d: Date) => DIA_BRASILIA.format(d);
export const HORA_BRASILIA = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

export const descreverFiltros = (f: Omit<FiltroHistorico, 'pagina'>) =>
  [
    `período ${diaBrasilia(f.de)} a ${diaBrasilia(f.ate)}`,
    ...(f.usuario ? [`usuário "${f.usuario}"`] : []),
    ...(f.funcionalidade ? [`funcionalidade ${f.funcionalidade}`] : []),
    ...(f.tipo ? [`tipo ${f.tipo}`] : []),
  ].join(', ');

// As colunas e os campos da listagem do UC02.24: sem antes/depois, que ainda não têm a máscara por
// perfil (D-P8-10). A mesma forma no arquivo síncrono e no assíncrono.
export const COLUNAS_HISTORICO = [
  { titulo: 'Data da Operação', tipo: 'texto', largura: 18 },
  { titulo: 'Usuário', tipo: 'texto', largura: 24 },
  { titulo: 'Funcionalidade', tipo: 'texto', largura: 24 },
  { titulo: 'Tipo de Operação', tipo: 'texto', largura: 16 },
  { titulo: 'Descrição', tipo: 'texto', largura: 80 },
] as const;
export const CAMPOS_EXPORTACAO = { descricao: true, usuarioRotulo: true, funcionalidade: true, ocorridoEm: true, tipoOperacao: true } as const;
type LinhaExportacao = { descricao: string; usuarioRotulo: string; funcionalidade: string; ocorridoEm: Date; tipoOperacao: string };
export const linhaDaExportacao = (l: LinhaExportacao) => [HORA_BRASILIA.format(l.ocorridoEm), l.usuarioRotulo, l.funcionalidade, l.tipoOperacao, l.descricao];

// O pedido assíncrono leva quem pediu e os filtros da tela, já validados. As datas vão em ISO 8601.
export type ParametrosExportacaoHistorico = { usuarioId: string; de: string; ate: string; usuario?: string; funcionalidade?: string; tipo?: TipoOperacao };

export function parametrosDoPedido(usuarioId: string, f: Omit<FiltroHistorico, 'pagina'>): ParametrosExportacaoHistorico {
  return {
    usuarioId,
    de: f.de.toISOString(),
    ate: f.ate.toISOString(),
    ...(f.usuario ? { usuario: f.usuario } : {}),
    ...(f.funcionalidade ? { funcionalidade: f.funcionalidade } : {}),
    ...(f.tipo ? { tipo: f.tipo } : {}),
  };
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const opcional = (v: unknown, valido: (s: string) => boolean): v is string | undefined => v === undefined || (typeof v === 'string' && v !== '' && valido(v));

/**
 * Os parâmetros gravados no pedido vêm do banco: são lidos de novo, campo a campo, com as mesmas
 * regras da tela (filtro-historico.ts). Chave a mais ou valor fora do formato recusa o pedido.
 */
export function lerParametrosPedido(parametros: unknown): Resultado<{ usuarioId: string; filtro: Omit<FiltroHistorico, 'pagina'> }> {
  const invalido = falha([{ campo: '_', mensagem: MENSAGEM_PEDIDO_INVALIDO }]);
  if (typeof parametros !== 'object' || parametros === null || Array.isArray(parametros)) return invalido;
  const p = parametros as Record<string, unknown>;
  const conhecidas = new Set(['usuarioId', 'de', 'ate', 'usuario', 'funcionalidade', 'tipo']);
  if (Object.keys(p).some((k) => !conhecidas.has(k))) return invalido;
  const { usuarioId, de, ate, usuario, funcionalidade, tipo } = p;
  if (typeof usuarioId !== 'string' || !UUID.test(usuarioId)) return invalido;
  if (typeof de !== 'string' || !ISO.test(de) || typeof ate !== 'string' || !ISO.test(ate)) return invalido;
  if (!opcional(usuario, (s) => s.length <= MAXIMO_USUARIO)) return invalido;
  if (!opcional(funcionalidade, (s) => CODIGO.test(s))) return invalido;
  if (!opcional(tipo, (s) => (TIPOS_OPERACAO as readonly string[]).includes(s))) return invalido;
  const filtro = {
    de: new Date(de),
    ate: new Date(ate),
    ...(usuario ? { usuario } : {}),
    ...(funcionalidade ? { funcionalidade } : {}),
    ...(tipo ? { tipo: tipo as TipoOperacao } : {}),
  };
  const v = validarFiltroHistorico(filtro);
  return v.ok ? ok({ usuarioId, filtro }) : falha(v.erros);
}

/** Os filtros legíveis do cabeçalho do arquivo (RN0011). */
export function filtrosLegiveis(f: Omit<FiltroHistorico, 'pagina'>): FiltroExportacao[] {
  return [
    { rotulo: 'Período', valor: `${diaBrasilia(f.de)} a ${diaBrasilia(f.ate)}` },
    ...(f.usuario ? [{ rotulo: 'Usuário', valor: f.usuario }] : []),
    ...(f.funcionalidade ? [{ rotulo: 'Funcionalidade', valor: f.funcionalidade }] : []),
    ...(f.tipo ? [{ rotulo: 'Tipo de Operação', valor: f.tipo }] : []),
  ];
}

/**
 * O gerador do worker: confere, na transação da geração, que quem pediu continua ativo, sem bloqueio
 * e com adm.historico:exportar; depois aplica o alcance do perfil dele hoje (o Auditor só vê as
 * funcionalidades do perfil) e os filtros e o período do pedido.
 */
export const gerarExportacaoHistorico: GeradorExportacao = async (tx, parametros): Promise<Resultado<ConteudoExportacao>> => {
  const lido = lerParametrosPedido(parametros);
  if (!lido.ok) return falha(lido.erros);
  const { usuarioId, filtro } = lido.valor;
  const usuario = await tx.usuario.findUnique({ where: { id: usuarioId }, select: { ativo: true, bloqueado: true } });
  const permissoes = usuario?.ativo && !usuario.bloqueado ? await carregarPermissoes(tx, usuarioId) : new Set<string>();
  if (!permissoes.has(`${FUNCIONALIDADE_HISTORICO}:exportar`)) return falha([{ campo: '_', mensagem: MENSAGEM_SEM_PERMISSAO_EXPORTAR }]);
  const where = await filtroDoHistorico(usuarioId, filtro, tx);
  // Acima do teto, o worker recusaria o arquivo: avisa sem carregar as linhas.
  const total = await tx.historicoOperacao.count({ where });
  if (total > LIMITE_EXPORTACAO_ASSINCRONA) {
    return falha([{ campo: 'linhas', mensagem: `A exportação tem ${total} linhas; o máximo é ${LIMITE_EXPORTACAO_ASSINCRONA}. Use filtros para reduzir.` }]);
  }
  const linhas = await tx.historicoOperacao.findMany({ where, orderBy: [{ ocorridoEm: 'desc' }, { id: 'desc' }], select: CAMPOS_EXPORTACAO });
  return ok({ planilha: { nome: TITULO_HISTORICO, colunas: COLUNAS_HISTORICO, linhas: linhas.map(linhaDaExportacao) }, filtros: filtrosLegiveis(filtro) });
};

/** Os geradores do adm para a exportação assíncrona, por funcionalidade (o worker os passa ao ger). */
export const GERADORES_EXPORTACAO_ADM: Readonly<Record<string, GeradorExportacao>> = {
  [FUNCIONALIDADE_HISTORICO]: gerarExportacaoHistorico,
};
