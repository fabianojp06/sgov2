import type { TxCliente } from '@/shared/db';
import {
  compararClassificacao,
  montarIndice,
  prepararArvoreCentrosCusto,
  prepararArvoreContas,
  type IndiceEstruturaFinanceira,
  type NoCentroCusto,
  type NoConta,
  type OpcoesArvore,
} from '../domain/estrutura';

// Implementações reais do C1 (plano do P4, Tasks 2, 4b e 5): contas e centros de custo do banco.
//
// R3: recebem o `tx` do consumidor, para ler na mesma transação, e não têm guarda própria: quem
// chama já passou pela guarda da sua funcionalidade. Nunca são expostas como Server Action.
// R22: este arquivo não importa @/shared/authz nem next/, porque o servidor.ts o reexporta.

// A árvore inteira (com as inativas) é pequena (174 contas no plano oficial): lê de uma vez.
async function lerArvoreContas(tx: TxCliente): Promise<NoConta[]> {
  const linhas = await tx.contaContabil.findMany({
    select: {
      id: true,
      paiId: true,
      classificacao: true,
      codigoReduzido: true,
      descricao: true,
      nivel: true,
      tipo: true,
      ativa: true,
      parametroLocal: { select: { natureza: true } },
    },
  });
  const filhos = new Map<string | null, typeof linhas>();
  for (const l of linhas) filhos.set(l.paiId, [...(filhos.get(l.paiId) ?? []), l]);
  const montar = (paiId: string | null): NoConta[] =>
    (filhos.get(paiId) ?? [])
      .sort((a, b) => compararClassificacao(a.classificacao, b.classificacao))
      .map((l) => ({
        classificacao: l.classificacao,
        codigoReduzido: l.codigoReduzido,
        descricao: l.descricao,
        nivel: l.nivel as NoConta['nivel'],
        tipo: l.tipo,
        ativa: l.ativa,
        natureza: l.tipo === 'ANALITICA' ? (l.parametroLocal?.natureza ?? null) : null,
        filhos: montar(l.id),
      }));
  return montar(null);
}

/** Árvore do plano de contas, com os filhos ordenados pela classificação. */
export async function listarArvoreContas(tx: TxCliente, opcoes?: OpcoesArvore): Promise<readonly NoConta[]> {
  return prepararArvoreContas(await lerArvoreContas(tx), opcoes);
}

async function lerArvoreCentrosCusto(tx: TxCliente): Promise<NoCentroCusto[]> {
  const linhas = await tx.centroCusto.findMany({
    select: {
      id: true,
      paiId: true,
      classificacao: true,
      codigoReduzido: true,
      descricao: true,
      nivel: true,
      tipo: true,
      ativo: true,
      deGestao: true,
      natureza: true,
      provisorio: true,
    },
  });
  const filhos = new Map<string | null, typeof linhas>();
  for (const l of linhas) filhos.set(l.paiId, [...(filhos.get(l.paiId) ?? []), l]);
  const montar = (paiId: string | null): NoCentroCusto[] =>
    (filhos.get(paiId) ?? [])
      .sort((a, b) => compararClassificacao(a.classificacao, b.classificacao))
      .map((l) => ({
        classificacao: l.classificacao,
        codigoReduzido: l.codigoReduzido,
        descricao: l.descricao,
        nivel: l.nivel as NoCentroCusto['nivel'],
        tipo: l.tipo,
        ativo: l.ativo,
        deGestao: l.deGestao,
        natureza: l.natureza,
        provisorio: l.provisorio,
        filhos: montar(l.id),
      }));
  return montar(null);
}

/** Árvore dos centros de custo, com os filhos ordenados pela classificação. */
export async function listarArvoreCentrosCusto(tx: TxCliente, opcoes?: OpcoesArvore): Promise<readonly NoCentroCusto[]> {
  return prepararArvoreCentrosCusto(await lerArvoreCentrosCusto(tx), opcoes);
}

/**
 * Analítica e ativa: só ela recebe valor (spec §6.1). Ativa já implica os ancestrais ativos: o
 * banco recusa conta ativa sob conta inativa (M-n3).
 */
export async function ehContaAnaliticaAtiva(tx: TxCliente, classificacao: string): Promise<boolean> {
  const n = await tx.contaContabil.count({ where: { classificacao, tipo: 'ANALITICA', ativa: true } });
  return n > 0;
}

/** Analítico e ativo (ativo já implica os ancestrais ativos, M-n3). */
export async function ehCentroCustoAnalitico(tx: TxCliente, classificacao: string): Promise<boolean> {
  return (await tx.centroCusto.count({ where: { classificacao, tipo: 'ANALITICO', ativo: true } })) > 0;
}

/** Carrega as duas árvores ativas uma vez, para validar muitas linhas sem uma consulta por linha. */
export async function carregarIndiceEstrutura(tx: TxCliente): Promise<IndiceEstruturaFinanceira> {
  return montarIndice(await lerArvoreContas(tx), await lerArvoreCentrosCusto(tx));
}
