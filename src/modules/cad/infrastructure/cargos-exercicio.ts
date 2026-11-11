import type { TxCliente } from '@/shared/db';
import { ErroDominio, type Dinheiro } from '@/shared/kernel';
import type { FonteAtiva } from '../domain/cargo';
import type { AdicionalTrabalhista, BeneficioPremissa } from '../domain/custo-pessoal';
import type { CifraSalarios } from './cifra-salarios';
import { dinheiroDoDecimal, salarioFonteAtiva } from './fonte-ativa';
import { obterPremissasExercicio } from './premissas';

// C2, acréscimo de C&S (resto da US-056 e US-064; combinado com a frente A na #138 em 11/11). Recebem o
// tx, sem guarda: a permissão é de quem chama. Os salários saem decifrados para o cálculo; quem mostrar
// na tela segue a máscara de cad.salarios (R24), e o salário nunca vai para a IA.

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
 * Cargos do cadastro (únicos para todo exercício), em ordem de código; por padrão, só os ativos. Esta é a
 * versão do servidor.ts (worker e casos de uso sem a cifra): a Fonte Ativa cifrada (REAL, DEFINIDO,
 * TOTAL) sai sem salário, porque a chave só existe no app. Pelo index.ts (app), o salário sai decifrado.
 */
export async function listarCargosExercicio(tx: TxCliente, opcoes: OpcoesCargosExercicio = {}): Promise<readonly CargoExercicio[]> {
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
      // Envelope ilegível ou chave ausente: o cargo fica sem salário (a posição não o usa), sem derrubar a lista.
      if (!(e instanceof ErroDominio && ['cad.cifra_invalida', 'cad.cifra_indisponivel'].includes(e.codigo))) throw e;
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

/**
 * Benefícios do cargo no exercício, no formato das premissas: as escolhas do cargo (ativo e valor
 * manual) sobre a Tabela Mestre; sem escolha própria, o padrão da Tabela Mestre. Ano sem parâmetros: [].
 */
export async function beneficiosDoCargo(tx: TxCliente, ano: number, cargoId: string): Promise<readonly BeneficioPremissa[]> {
  const escolhas = await tx.beneficioCargo.findMany({ where: { cargoId, ano }, select: { codigo: true, ativo: true, valorManual: true } });
  const escolha = new Map(escolhas.map((b) => [b.codigo, { ativo: b.ativo, valorManual: dinheiroDoDecimal(b.valorManual) }]));
  return (await obterPremissasExercicio(tx, ano, escolha))?.beneficios ?? [];
}
