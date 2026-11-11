import 'server-only';
import type { TxCliente } from '@/shared/db';
import { criarCifraSalarios, type CifraSalarios } from '../infrastructure/cifra-salarios';
import { listarCargosComCifra, type CargoExercicio, type OpcoesCargosExercicio } from '../infrastructure/cargos-exercicio';

// C2, acréscimo de C&S, na versão do app (index.ts): o salário da Fonte Ativa sai decifrado, com a chave
// que só o app tem (sem a chave, cad.cifra_indisponivel sobe). O worker usa o listarCargosSemSalarioCifrado
// do servidor.ts. Quem mostrar salário sem máscara audita (R24; ver infrastructure/cargos-exercicio.ts).

/** Cargos do cadastro com o salário da Fonte Ativa decifrado (a cifra é criada só se uma fonte precisar). */
export async function listarCargosExercicio(
  tx: TxCliente,
  opcoes: OpcoesCargosExercicio & { cifra?: CifraSalarios } = {},
): Promise<readonly CargoExercicio[]> {
  let cifra = opcoes.cifra;
  return listarCargosComCifra(tx, opcoes, () => (cifra ??= criarCifraSalarios()));
}
