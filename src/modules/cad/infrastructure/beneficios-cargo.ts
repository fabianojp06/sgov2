import { auditar, type ContextoAuditoria } from '@/shared/audit';
import type { TxCliente } from '@/shared/db';

// Benefícios do cargo (plano do P4, Task 13), sem guarda: chamado na transação de quem já passou pela
// guarda (a alteração da Tabela Mestre). RN_CAR_06 / C8: a atualização do item na Tabela Mestre apaga o
// valor manual dos cargos daquele (ano, código) e volta a origem para MESTRE, com um Histórico por cargo.
export async function sobrescreverManuaisDoItem(tx: TxCliente, contexto: ContextoAuditoria, ano: number, codigo: string): Promise<number> {
  const manuais = await tx.beneficioCargo.findMany({
    where: { ano, codigo, origem: 'MANUAL' },
    select: { cargoId: true, valorManual: true, cargo: { select: { codigo: true } } },
  });
  for (const m of manuais) {
    await tx.beneficioCargo.update({
      where: { cargoId_ano_codigo: { cargoId: m.cargoId, ano, codigo } },
      data: { valorManual: null, origem: 'MESTRE', atualizadoEm: new Date() },
    });
    // A versão do cargo sobe: uma tela aberta antes não reenvia o valor manual apagado (concorrência).
    await tx.cargo.update({ where: { id: m.cargoId }, data: { versao: { increment: 1 } } });
    await auditar(tx, {
      contexto,
      funcionalidade: 'cad.cargos',
      tipo: 'ALTERACAO',
      registroId: m.cargo.codigo,
      descricao: `Benefício ${codigo} de ${ano} do cargo ${m.cargo.codigo} voltou ao valor da Tabela Mestre`,
      antes: { codigo, origem: 'MANUAL', valorManual: m.valorManual?.toFixed(2) ?? null },
      depois: { codigo, origem: 'MESTRE', valorManual: null },
    });
  }
  return manuais.length;
}

/**
 * Exercício novo a partir de um ano-base (decisão do PO, 03/11): os benefícios de cada cargo vêm
 * junto, com o ativo, o valor manual e a origem (MANUAL continua MANUAL, para o GRH revisar).
 * Cargo inativo também, para a configuração voltar se ele for reativado. O filtro pelos itens da
 * Tabela Mestre do ano novo é defesa (hoje ela é cópia integral da base, e a FK garante o resto).
 * Um Histórico só para o exercício, com os itens por cargo (centenas de cargos não alongam a
 * transação do orc). Chamado com a linha do ano-base presa (criarParametrosDoAno). Devolve quantos cargos.
 */
export async function copiarBeneficiosCargoDoAno(tx: TxCliente, contexto: ContextoAuditoria, ano: number, anoBase: number): Promise<number> {
  const codigos = new Set((await tx.beneficioMestre.findMany({ where: { ano }, select: { codigo: true } })).map((m) => m.codigo));
  const base = (await tx.beneficioCargo.findMany({
    where: { ano: anoBase },
    select: { cargoId: true, codigo: true, ativo: true, valorManual: true, origem: true, cargo: { select: { codigo: true } } },
    orderBy: [{ cargoId: 'asc' }, { codigo: 'asc' }],
  })).filter((b) => codigos.has(b.codigo));
  if (base.length === 0) return 0;
  // Sem skipDuplicates: o ano é novo (trava e conferência do criarParametrosDoAno); duplicata é erro.
  await tx.beneficioCargo.createMany({
    data: base.map((b) => ({ cargoId: b.cargoId, ano, codigo: b.codigo, ativo: b.ativo, valorManual: b.valorManual, origem: b.origem })),
  });
  const porCargo: Record<string, { codigo: string; ativo: boolean; valorManual: string | null; origem: string }[]> = {};
  for (const b of base) (porCargo[b.cargo.codigo] ??= []).push({ codigo: b.codigo, ativo: b.ativo, valorManual: b.valorManual?.toFixed(2) ?? null, origem: b.origem });
  const cargos = Object.keys(porCargo).length;
  await auditar(tx, {
    contexto,
    origem: contexto.usuarioId === null ? 'SISTEMA' : 'USUARIO',
    funcionalidade: 'cad.cargos',
    tipo: 'INSERCAO',
    registroId: String(ano),
    descricao: `Benefícios de ${cargos} cargo(s) copiados de ${anoBase} para ${ano}`,
    depois: porCargo,
  });
  return cargos;
}
