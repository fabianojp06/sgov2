import { auditar, type ContextoAuditoria } from '@/shared/audit';
import type { TxCliente } from '@/shared/db';
import { ErroDominio, type Dinheiro } from '@/shared/kernel';
import { valorMensalPorPessoa } from '../domain/beneficios';
import type { BeneficioPremissa, PremissasExercicio } from '../domain/custo-pessoal';
import { calcularCustoPosicao as motor } from '../domain/motor-custo-pessoal';
import { lerBeneficiosMestre } from './beneficios-mestre';
import { carregarIndiceEstrutura } from './estrutura-financeira';
import { criarParametrosDoAno, lerParametrosExercicio } from './parametro-sistema';

// Implementações reais do C2 (plano do P4, Tasks 3, 9a e 11): o motor, as premissas completas do
// exercício, o garantir e o congelar.
//
// R3: recebem o `tx` do consumidor e não têm guarda própria; nunca são expostas como Server Action.
// R22: este arquivo não importa @/shared/authz nem next/, porque o servidor.ts o reexporta.

/**
 * Custo mês a mês da posição, por componente e conta, na ordem de operações e com os
 * arredondamentos da R14 (encargos pela R13; benefício percentual pela R14a). Função pura: posição
 * ou premissas inválidas voltam como erro por campo (R3), nunca como exceção.
 */
export const calcularCustoPosicao = motor;

/** Escolha de benefícios de um cargo (Task 13): ativo e valor manual por código; sem a escolha, os "padrão da posição". */
export type EscolhaBeneficios = ReadonlyMap<string, { ativo: boolean; valorManual: Dinheiro | null }>;

/**
 * Premissas completas do ano, ou null se o ano ainda não tem parâmetros. Os benefícios da posição
 * sem cargo (C34) são os itens ativos da Tabela Mestre marcados como padrão e com valor; o diário vira
 * mensal pelos dias úteis. Item padrão sem valor e conta que não é mais analítica ativa (recarga do
 * plano) geram aviso; a conta inválida vai vazia, e o cálculo recusa o componente. Com a `escolha` de
 * um cargo, valem os ativos dele e o valor manual no lugar do da Tabela Mestre.
 */
export async function obterPremissasExercicio(tx: TxCliente, ano: number, escolha?: EscolhaBeneficios): Promise<PremissasExercicio | null> {
  const base = await lerBasePremissas(tx, ano);
  return base ? montarPremissas(base, escolha) : null;
}

/** O que as premissas do ano leem do banco: lido uma vez e montado para cada cargo (beneficiosDosCargos). */
export type BasePremissas = Readonly<{
  p: NonNullable<Awaited<ReturnType<typeof lerParametrosExercicio>>>;
  indice: Awaited<ReturnType<typeof carregarIndiceEstrutura>>;
  mestre: Awaited<ReturnType<typeof lerBeneficiosMestre>>;
}>;

/** Parâmetros, índice da estrutura e Tabela Mestre do ano, ou null se o ano não tem parâmetros. */
export async function lerBasePremissas(tx: TxCliente, ano: number): Promise<BasePremissas | null> {
  if (!Number.isInteger(ano)) return null;
  const p = await lerParametrosExercicio(tx, ano);
  if (!p) return null;
  return { p, indice: await carregarIndiceEstrutura(tx), mestre: await lerBeneficiosMestre(tx, ano) };
}

/** As premissas a partir da base lida, com a escolha de benefícios de um cargo. Sem acesso ao banco. */
export function montarPremissas({ p, indice, mestre }: BasePremissas, escolha?: EscolhaBeneficios): PremissasExercicio {
  const ano = p.ano;
  const avisos: string[] = [];
  const conta = (classificacao: string, rotulo: string): string => {
    if (indice.contaAnaliticaAtiva(classificacao)) return classificacao;
    avisos.push(`A conta ${classificacao} de ${rotulo} não é mais analítica ativa: corrija os parâmetros de ${ano}.`);
    return '';
  };
  const beneficios: BeneficioPremissa[] = [];
  for (const item of mestre) {
    const doCargo = escolha?.get(item.codigo);
    if (!item.ativo || !(doCargo ? doCargo.ativo : item.padraoPosicao)) continue;
    // O valor manual do cargo (RN_CAR_07) no lugar do da Tabela Mestre.
    const b = doCargo?.valorManual ? { ...item, valor: doCargo.valorManual } : item;
    const motivo = doCargo ? 'está ativo no cargo' : 'é padrão da posição';
    if (b.forma === 'PERCENTUAL_SALARIO') {
      if (b.percentual === null) avisos.push(`O benefício ${b.nome} ${motivo}, mas está sem percentual na Tabela Mestre de ${ano}.`);
      else beneficios.push({ componente: b.codigo, nome: b.nome, forma: 'PERCENTUAL_SALARIO', percentual: b.percentual, conta: conta(b.conta, b.nome) });
      continue;
    }
    const mensal = valorMensalPorPessoa(b, p.diasUteisMes);
    if (mensal === null) avisos.push(`O benefício ${b.nome} ${motivo}, mas está sem valor na Tabela Mestre de ${ano}.`);
    else beneficios.push({ componente: b.codigo, nome: b.nome, forma: 'VALOR_MENSAL', valorMensal: mensal, conta: conta(b.conta, b.nome) });
  }
  return {
    ano: p.ano,
    versao: p.versao,
    congelado: p.congelado,
    provisorio: p.provisorio,
    reajuste: p.reajuste,
    mesDataBase: p.mesDataBase,
    ipca: p.ipca,
    salarioMinimo: p.salarioMinimo,
    encargos: p.encargos.map((e) => ({ ...e, conta: conta(e.conta, e.nome) })),
    contas: {
      salario: conta(p.contas.salario, 'salário'),
      adicional: conta(p.contas.adicional, 'adicional'),
      ferias: conta(p.contas.ferias, 'férias'),
      decimo_terceiro: conta(p.contas.decimo_terceiro, '13º'),
    },
    beneficios,
    avisos,
  };
}

/**
 * US-055: cria os parâmetros do ano (e a Tabela Mestre) copiando o último ano anterior, ou os
 * padrões provisórios. Idempotente e auditado. Devolve as premissas completas.
 */
export async function garantirPremissasExercicio(tx: TxCliente, contexto: ContextoAuditoria, ano: number): Promise<PremissasExercicio> {
  await criarParametrosDoAno(tx, contexto, ano);
  const p = await obterPremissasExercicio(tx, ano);
  if (!p) throw new ErroDominio('cad.premissas_inexistentes', `O exercício ${ano} não tem parâmetros.`);
  return p;
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
