import type { TxCliente } from '@/shared/db';
import { ErroDominio } from '@/shared/kernel';
import {
  compararClassificacao,
  montarIndice,
  prepararArvoreContas,
  type IndiceEstruturaFinanceira,
  type NoCentroCusto,
  type NoConta,
  type OpcoesArvore,
} from '../domain/estrutura';

// Implementações reais do C1 (plano do P4, Tasks 2 e 4b). As contas já leem do banco; os centros
// de custo ficam indisponíveis até a Task 5. Até lá, os consumidores usam os falsos para os CCs.
//
// R3: recebem o `tx` do consumidor, para ler na mesma transação, e não têm guarda própria: quem
// chama já passou pela guarda da sua funcionalidade. Nunca são expostas como Server Action.
// R22: este arquivo não importa @/shared/authz nem next/, porque o servidor.ts o reexporta.

function erroIndisponivel(): ErroDominio {
  return new ErroDominio('cad.estrutura_indisponivel', 'A estrutura financeira ainda não está disponível.');
}

async function indisponivel(): Promise<never> {
  throw erroIndisponivel();
}

// A árvore inteira (com as inativas) é pequena (174 contas no plano oficial): lê de uma vez.
async function lerArvoreContas(tx: TxCliente): Promise<NoConta[]> {
  const linhas = await tx.contaContabil.findMany({
    select: { id: true, paiId: true, classificacao: true, codigoReduzido: true, descricao: true, nivel: true, tipo: true, ativa: true },
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
        filhos: montar(l.id),
      }));
  return montar(null);
}

/** Árvore do plano de contas, com os filhos ordenados pela classificação. */
export async function listarArvoreContas(tx: TxCliente, opcoes?: OpcoesArvore): Promise<readonly NoConta[]> {
  return prepararArvoreContas(await lerArvoreContas(tx), opcoes);
}

/** Árvore dos centros de custo, com os filhos ordenados pela classificação. Disponível na Task 5. */
export const listarArvoreCentrosCusto: (tx: TxCliente, opcoes?: OpcoesArvore) => Promise<readonly NoCentroCusto[]> =
  indisponivel;

/**
 * Analítica e ativa: só ela recebe valor (spec §6.1). Ativa já implica os ancestrais ativos: o
 * banco recusa conta ativa sob conta inativa (M-n3).
 */
export async function ehContaAnaliticaAtiva(tx: TxCliente, classificacao: string): Promise<boolean> {
  const n = await tx.contaContabil.count({ where: { classificacao, tipo: 'ANALITICA', ativa: true } });
  return n > 0;
}

/** Analítico e ativo. Disponível na Task 5. */
export const ehCentroCustoAnalitico: (tx: TxCliente, classificacao: string) => Promise<boolean> = indisponivel;

/**
 * Carrega as duas árvores ativas uma vez, para validar muitas linhas sem uma consulta por linha.
 * Até a Task 5, a parte dos centros de custo lança cad.estrutura_indisponivel quando usada.
 */
export async function carregarIndiceEstrutura(tx: TxCliente): Promise<IndiceEstruturaFinanceira> {
  const contas = montarIndice(await lerArvoreContas(tx), []);
  return Object.freeze({
    contaAnaliticaAtiva: contas.contaAnaliticaAtiva,
    contasAnaliticasSob: contas.contasAnaliticasSob,
    nosContas: contas.nosContas,
    centroCustoAnalitico: (): boolean => {
      throw erroIndisponivel();
    },
    centrosCustoAnaliticosSob: (): readonly string[] => {
      throw erroIndisponivel();
    },
    get nosCentrosCusto(): readonly never[] {
      throw erroIndisponivel();
    },
  });
}
