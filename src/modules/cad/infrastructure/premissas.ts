import type { ContextoAuditoria } from '@/shared/audit';
import type { TxCliente } from '@/shared/db';
import { ErroDominio, type Resultado } from '@/shared/kernel';
import type { PosicaoPessoal, PremissasExercicio, SerieMensalComponentes } from '../domain/custo-pessoal';

// Implementações reais do C2 (plano do P4, Task 3). Ficam indisponíveis até os parâmetros por
// exercício (Task 9a) e o MotorCustoPessoal (Task 11). Até lá, os consumidores usam os falsos.
//
// R3: recebem o `tx` do consumidor e não têm guarda própria; nunca são expostas como Server Action.
// R22: este arquivo não importa @/shared/authz nem next/, porque o servidor.ts o reexporta.

async function indisponivelAssincrono(): Promise<never> {
  throw new ErroDominio('cad.custo_pessoal_indisponivel', 'O cálculo do custo de pessoal ainda não está disponível.');
}

function indisponivel(): never {
  throw new ErroDominio('cad.custo_pessoal_indisponivel', 'O cálculo do custo de pessoal ainda não está disponível.');
}

/**
 * Custo mês a mês da posição, por componente e conta, na ordem de operações e com os
 * arredondamentos da R14 (encargos pela R13; benefício percentual pela R14a). Função pura: posição
 * inválida volta como erro por campo (R3), nunca como exceção. Até a Task 11, lança
 * ErroDominio('cad.custo_pessoal_indisponivel'): indisponível não é erro de validação.
 */
export const calcularCustoPosicao: (posicao: PosicaoPessoal, premissas: PremissasExercicio) => Resultado<SerieMensalComponentes> =
  indisponivel;

/** Parâmetros do ano, ou null se o ano ainda não tem parâmetros. */
export const obterPremissasExercicio: (tx: TxCliente, ano: number) => Promise<PremissasExercicio | null> = indisponivelAssincrono;

/**
 * US-055: cria os parâmetros do ano (e a Tabela Mestre, a partir da Task 10) copiando o último ano
 * anterior, ou os padrões provisórios. Idempotente e auditado.
 */
export const garantirPremissasExercicio: (tx: TxCliente, contexto: ContextoAuditoria, ano: number) => Promise<PremissasExercicio> =
  indisponivelAssincrono;

/**
 * Congela os parâmetros do ano quando a frente A oficializa o exercício. Idempotente e auditado.
 * Não muda a `versao`. Ano sem parâmetros: ErroDominio('cad.premissas_inexistentes').
 */
export const congelarPremissasExercicio: (tx: TxCliente, contexto: ContextoAuditoria, ano: number) => Promise<void> =
  indisponivelAssincrono;
