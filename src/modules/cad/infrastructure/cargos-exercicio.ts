import type { TxCliente } from '@/shared/db';
import { ErroDominio, type Dinheiro } from '@/shared/kernel';
import type { FonteAtiva } from '../domain/cargo';
import type { AdicionalTrabalhista, BeneficioPremissa } from '../domain/custo-pessoal';
import type { CifraSalarios } from './cifra-salarios';
import { dinheiroDoDecimal, salarioFonteAtiva } from './fonte-ativa';
import { obterPremissasExercicio } from './premissas';

// C2, acréscimo de C&S (resto da US-056 e US-064; combinado com a frente A na #138 em 11/11). Recebem o
// tx, sem guarda: a permissão é de quem chama. Os salários saem decifrados só para o cálculo (D10): o
// cálculo precisa deles mesmo para quem não tem cad.salarios, por isso o contrato não audita. Quem
// MOSTRAR um salário sem máscara confere cad.salarios:consultar E grava o CONSULTA em cad.salarios, com
// o cargo e sem os valores (R24), como o custo do cargo. O salário nunca vai para a IA.

export type CargoExercicio = Readonly<{
  id: string;
  codigo: string;
  /** Nome de mercado ou, sem ele, o oficial. */
  nome: string;
  ativo: boolean;
  fonteAtiva: FonteAtiva | null;
  /** Null: sem Fonte Ativa, sem valor nela ou envelope ilegível; a posição não usa esse cargo. */
  salarioFonteAtiva: Dinheiro | null;
  /** Faixa de mercado do cargo (a mesma do desvio de mercado); null sem mínimo ou sem máximo. */
  faixa: Readonly<{ minimo: Dinheiro; maximo: Dinheiro }> | null;
  adicional: AdicionalTrabalhista | null;
}>;

export type OpcoesCargosExercicio = { incluirInativos?: boolean };

/**
 * Cargos do cadastro (únicos para todo exercício), em ordem de código; por padrão, só os ativos. Versão do
 * servidor.ts (worker), com outro nome de propósito: a Fonte Ativa que depende de campo cifrado (REAL,
 * DEFINIDO, TOTAL com FG) sai sem salário, porque a chave só existe no app; a faixa, o adicional e as
 * fontes de mercado saem normais. No app, use o listarCargosExercicio do index.ts.
 */
export async function listarCargosSemSalarioCifrado(tx: TxCliente, opcoes: OpcoesCargosExercicio = {}): Promise<readonly CargoExercicio[]> {
  return listarCargosComCifra(tx, opcoes, () => null);
}

/** Com a cifra (o app injeta). */
export async function listarCargosComCifra(
  tx: TxCliente,
  opcoes: OpcoesCargosExercicio,
  obterCifra: () => CifraSalarios | null,
): Promise<readonly CargoExercicio[]> {
  const linhas = await tx.cargo.findMany({
    where: opcoes.incluirInativos ? {} : { ativo: true },
    orderBy: { codigo: 'asc' },
    select: {
      id: true,
      codigo: true,
      nomeOficial: true,
      nomeMercado: true,
      ativo: true,
      fonteAtiva: true,
      mercadoMinimo: true,
      mercadoMaximo: true,
      salarioRealCifrado: true,
      funcaoGratificadaCifrada: true,
      salarioDefinidoCifrado: true,
      adicionalTipo: true,
      adicionalGrau: true,
    },
  });
  return linhas.map((c) => {
    let salario: Dinheiro | null;
    try {
      salario = salarioFonteAtiva(c, obterCifra);
    } catch (e) {
      // Envelope ilegível: o cargo fica sem salário (a posição não o usa), sem derrubar a lista. A chave
      // ausente no app (cad.cifra_indisponivel) é erro de configuração: sobe, com a mensagem de tela.
      if (!(e instanceof ErroDominio && e.codigo === 'cad.cifra_invalida')) throw e;
      console.error('[CARGO_SALARIO_ILEGIVEL]', { cargo: c.codigo, codigo: e.codigo });
      salario = null;
    }
    const minimo = dinheiroDoDecimal(c.mercadoMinimo);
    const maximo = dinheiroDoDecimal(c.mercadoMaximo);
    const adicional: AdicionalTrabalhista | null =
      c.adicionalTipo === 'PERICULOSIDADE' ? { tipo: 'PERICULOSIDADE' } : c.adicionalTipo === 'INSALUBRIDADE' && c.adicionalGrau ? { tipo: 'INSALUBRIDADE', grau: c.adicionalGrau } : null;
    return {
      id: c.id,
      codigo: c.codigo,
      nome: c.nomeMercado?.trim() || c.nomeOficial,
      ativo: c.ativo,
      fonteAtiva: c.fonteAtiva,
      salarioFonteAtiva: salario,
      faixa: minimo && maximo ? { minimo, maximo } : null,
      adicional,
    };
  });
}

export type BeneficiosCargo = Readonly<{ beneficios: readonly BeneficioPremissa[]; avisos: readonly string[] }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NENHUM: BeneficiosCargo = { beneficios: [], avisos: [] };

/**
 * Benefícios do cargo no exercício, no formato das premissas: as escolhas do cargo (ativo e valor
 * manual) sobre a Tabela Mestre; sem escolha própria, o padrão da Tabela Mestre. Os avisos das premissas
 * vão junto (benefício sem valor, conta que deixou de ser analítica): o motor recusa esses componentes.
 * Cargo desconhecido (ou id que não é UUID) e ano sem parâmetros: nada. Uma leitura das premissas por
 * chamada: para muitos cargos do mesmo ano, peça uma versão em lote.
 */
export async function beneficiosDoCargo(tx: TxCliente, ano: number, cargoId: string): Promise<BeneficiosCargo> {
  if (!UUID.test(cargoId) || !(await tx.cargo.findUnique({ where: { id: cargoId }, select: { id: true } }))) return NENHUM;
  const escolhas = await tx.beneficioCargo.findMany({ where: { cargoId, ano }, select: { codigo: true, ativo: true, valorManual: true } });
  const escolha = new Map(escolhas.map((b) => [b.codigo, { ativo: b.ativo, valorManual: dinheiroDoDecimal(b.valorManual) }]));
  const p = await obterPremissasExercicio(tx, ano, escolha);
  return p ? { beneficios: p.beneficios, avisos: p.avisos } : NENHUM;
}
