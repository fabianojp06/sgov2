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
