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
 * junto, com o ativo, o valor manual e a origem (MANUAL continua MANUAL, para o GRH revisar). Só os
 * itens que existem na Tabela Mestre do ano novo. Um Histórico por cargo copiado. Devolve quantos.
 */
export async function copiarBeneficiosCargoDoAno(tx: TxCliente, contexto: ContextoAuditoria, ano: number, anoBase: number): Promise<number> {
  const codigos = new Set((await tx.beneficioMestre.findMany({ where: { ano }, select: { codigo: true } })).map((m) => m.codigo));
  const base = (await tx.beneficioCargo.findMany({
    where: { ano: anoBase },
    select: { cargoId: true, codigo: true, ativo: true, valorManual: true, origem: true, cargo: { select: { codigo: true } } },
    orderBy: [{ cargoId: 'asc' }, { codigo: 'asc' }],
  })).filter((b) => codigos.has(b.codigo));
  if (base.length === 0) return 0;
  await tx.beneficioCargo.createMany({
    data: base.map((b) => ({ cargoId: b.cargoId, ano, codigo: b.codigo, ativo: b.ativo, valorManual: b.valorManual, origem: b.origem })),
    skipDuplicates: true,
  });
  const porCargo = new Map<string, typeof base>();
  for (const b of base) porCargo.set(b.cargo.codigo, [...(porCargo.get(b.cargo.codigo) ?? []), b]);
  for (const [codigoCargo, itens] of porCargo) {
    await auditar(tx, {
      contexto,
      origem: contexto.usuarioId === null ? 'SISTEMA' : 'USUARIO',
      funcionalidade: 'cad.cargos',
      tipo: 'INSERCAO',
      registroId: codigoCargo,
      descricao: `Benefícios de ${ano} do cargo ${codigoCargo} copiados de ${anoBase}`,
      depois: itens.map((b) => ({ codigo: b.codigo, ativo: b.ativo, valorManual: b.valorManual?.toFixed(2) ?? null, origem: b.origem })),
    });
  }
  return porCargo.size;
}
