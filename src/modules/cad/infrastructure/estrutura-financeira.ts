import type { TxCliente } from '@/shared/db';
import { ErroDominio } from '@/shared/kernel';
import type { IndiceEstruturaFinanceira, NoCentroCusto, NoConta, OpcoesArvore } from '../domain/estrutura';

// Implementações reais do C1 (plano do P4, Task 2). Ficam indisponíveis até as tabelas do plano de
// contas (Task 4b) e dos centros de custo (Task 5). Até lá, os consumidores usam os falsos.
//
// R3: recebem o `tx` do consumidor, para ler na mesma transação, e não têm guarda própria: quem
// chama já passou pela guarda da sua funcionalidade. Nunca são expostas como Server Action.
// R22: este arquivo não importa @/shared/authz nem next/, porque o servidor.ts o reexporta.

async function indisponivel(): Promise<never> {
  throw new ErroDominio('cad.estrutura_indisponivel', 'A estrutura financeira ainda não está disponível.');
}

/** Árvore do plano de contas, com os filhos ordenados pela classificação. */
export const listarArvoreContas: (tx: TxCliente, opcoes?: OpcoesArvore) => Promise<readonly NoConta[]> = indisponivel;

/** Árvore dos centros de custo, com os filhos ordenados pela classificação. */
export const listarArvoreCentrosCusto: (tx: TxCliente, opcoes?: OpcoesArvore) => Promise<readonly NoCentroCusto[]> =
  indisponivel;

/** Analítica e ativa: só ela recebe valor (spec §6.1). */
export const ehContaAnaliticaAtiva: (tx: TxCliente, classificacao: string) => Promise<boolean> = indisponivel;

/** Analítico e ativo. */
export const ehCentroCustoAnalitico: (tx: TxCliente, classificacao: string) => Promise<boolean> = indisponivel;

/** Carrega as duas árvores ativas uma vez, para validar muitas linhas sem uma consulta por linha. */
export const carregarIndiceEstrutura: (tx: TxCliente) => Promise<IndiceEstruturaFinanceira> = indisponivel;
