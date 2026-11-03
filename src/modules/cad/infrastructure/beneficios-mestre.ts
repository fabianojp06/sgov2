import type { TxCliente } from '@/shared/db';
import { Dinheiro, Percentual } from '@/shared/kernel';
import type { BeneficioMestre } from '../domain/beneficios';

// Tabela Mestre de Benefícios no banco (plano do P4, Task 10, R12). Sem guarda (R22): usada pelos
// casos de uso, pelo garantir do C2 e pela seed.

/** Itens provisórios de 2027, sem valor (pendência P6: a GRH preenche antes da US-121). */
export const BENEFICIOS_PADRAO = [
  { codigo: 'beneficio.va', nome: 'Vale-alimentação', forma: 'VALOR_DIARIO', conta: '4.1.1.1.021', padraoPosicao: false },
  { codigo: 'beneficio.vr', nome: 'Vale-refeição', forma: 'VALOR_DIARIO', conta: '4.1.1.1.009', padraoPosicao: true },
  { codigo: 'beneficio.saude_basico', nome: 'Seguro saúde (básico)', forma: 'VALOR_MENSAL', conta: '4.1.1.1.008', padraoPosicao: true },
  { codigo: 'beneficio.saude_intermediario', nome: 'Seguro saúde (intermediário)', forma: 'VALOR_MENSAL', conta: '4.1.1.1.008', padraoPosicao: false },
  { codigo: 'beneficio.saude_executivo', nome: 'Seguro saúde (executivo)', forma: 'VALOR_MENSAL', conta: '4.1.1.1.008', padraoPosicao: false },
  { codigo: 'beneficio.odonto', nome: 'Plano odontológico', forma: 'VALOR_MENSAL', conta: '4.1.1.1.013', padraoPosicao: false },
  { codigo: 'beneficio.seguro_vida', nome: 'Seguro de vida', forma: 'VALOR_MENSAL', conta: '4.1.1.1.007', padraoPosicao: true },
] as const;

export async function lerBeneficiosMestre(tx: TxCliente, ano: number): Promise<BeneficioMestre[]> {
  const itens = await tx.beneficioMestre.findMany({ where: { ano }, orderBy: { codigo: 'asc' } });
  return itens.map((b) => ({
    codigo: b.codigo as `beneficio.${string}`,
    nome: b.nome,
    forma: b.forma,
    valor: b.valor === null ? null : Dinheiro.de(b.valor.toString()),
    percentual: b.percentual === null ? null : Percentual.dePontos(b.percentual.toString()),
    conta: b.conta,
    padraoPosicao: b.padraoPosicao,
    ativo: b.ativo,
    provisorio: b.provisorio,
    versao: b.versao,
  }));
}

/** Copia a Tabela Mestre de um ano para outro (I5), ou cria os padrões quando não há ano base. */
export async function criarTabelaMestreDoAno(tx: TxCliente, ano: number, anoBase: number | null): Promise<void> {
  if (anoBase !== null) {
    const base = await tx.beneficioMestre.findMany({ where: { ano: anoBase } });
    if (base.length > 0) {
      await tx.beneficioMestre.createMany({
        data: base.map((b) => ({
          ano,
          codigo: b.codigo,
          nome: b.nome,
          forma: b.forma,
          valor: b.valor,
          percentual: b.percentual,
          conta: b.conta,
          padraoPosicao: b.padraoPosicao,
          ativo: b.ativo,
          provisorio: b.provisorio,
        })),
      });
      return;
    }
  }
  await tx.beneficioMestre.createMany({ data: BENEFICIOS_PADRAO.map((b) => ({ ano, ...b })) });
}
