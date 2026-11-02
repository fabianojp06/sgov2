import { auditar, type ContextoAuditoria } from '@/shared/audit';
import type { TxCliente } from '@/shared/db';
import { ErroDominio, type Resultado } from '@/shared/kernel';
import type { PosicaoPessoal, PremissasExercicio, SerieMensalComponentes } from '../domain/custo-pessoal';

import { criarParametrosDoAno, lerParametrosExercicio } from './parametro-sistema';

// Implementações reais do C2 (plano do P4, Tasks 3 e 9a). garantir e congelar já são reais; obter
// e o cálculo ficam indisponíveis até a Tabela Mestre (Task 10) e o MotorCustoPessoal (Task 11).
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
export async function garantirPremissasExercicio(tx: TxCliente, contexto: ContextoAuditoria, ano: number): Promise<PremissasExercicio> {
  await criarParametrosDoAno(tx, contexto, ano);
  const p = await lerParametrosExercicio(tx, ano);
  if (!p) throw new ErroDominio('cad.premissas_inexistentes', `O exercício ${ano} não tem parâmetros.`);
  // Os benefícios vêm da Tabela Mestre (Task 10); até lá, nenhum.
  return {
    ano: p.ano,
    versao: p.versao,
    congelado: p.congelado,
    provisorio: p.provisorio,
    reajuste: p.reajuste,
    mesDataBase: p.mesDataBase,
    ipca: p.ipca,
    salarioMinimo: p.salarioMinimo,
    encargos: p.encargos,
    contas: p.contas,
    beneficios: [],
    avisos: ['Tabela Mestre de Benefícios ainda não cadastrada.'],
  };
}

/**
 * Congela os parâmetros do ano quando a frente A oficializa o exercício. Idempotente e auditado.
 * Não muda a `versao`. Ano sem parâmetros: ErroDominio('cad.premissas_inexistentes').
 */
export async function congelarPremissasExercicio(tx: TxCliente, contexto: ContextoAuditoria, ano: number): Promise<void> {
  const linhas = await tx.$queryRaw<{ ano: number }[]>`UPDATE "parametros_exercicio" SET "congelado_em" = clock_timestamp()
    WHERE "ano" = ${ano} AND "congelado_em" IS NULL RETURNING "ano"`;
  if (linhas.length === 0) {
    const existe = await tx.parametrosExercicio.findUnique({ where: { ano }, select: { ano: true } });
    if (!existe) throw new ErroDominio('cad.premissas_inexistentes', `O exercício ${ano} não tem parâmetros.`);
    return; // já congelado: idempotente, sem novo Histórico
  }
  await auditar(tx, {
    contexto,
    origem: contexto.usuarioId === null ? 'SISTEMA' : 'USUARIO',
    funcionalidade: 'cad.parametros',
    tipo: 'ALTERACAO',
    registroId: String(ano),
    descricao: `Parâmetros de ${ano} congelados na oficialização do exercício`,
    antes: { congelado: false },
    depois: { congelado: true },
  });
}
