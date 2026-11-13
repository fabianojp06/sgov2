import { falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';

// Agrupadores de contas (US-047; RF_PLA_REQ_005, RN_PLA_007–011): um nome único e ao menos duas contas
// analíticas. Não são contas do plano (RN_PLA_007); uma conta pode estar em vários (RN_PLA_011). O valor
// do agrupador é sempre calculado nos relatórios, nunca digitado (RN_PLA_009).

export const TAMANHO_NOME_AGRUPADOR = 100;
export const MINIMO_CONTAS_AGRUPADOR = 2;
export const MSG_MINIMO = 'O Agrupador deve ter um Nome preenchido e ao menos duas contas analíticas selecionadas.';
export const MSG_NOME_REPETIDO = 'Já existe um Agrupador com este nome. Utilize um nome único.';

export type EntradaAgrupador = { nome: string; contaIds: readonly string[] };
export type AgrupadorValidado = { nome: string; contaIds: readonly string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validarAgrupador(e: EntradaAgrupador): Resultado<AgrupadorValidado> {
  const nome = e.nome.trim();
  const contaIds = [...new Set(e.contaIds.map((c) => c.toLowerCase()))];
  const erros: ErroCampo[] = [];
  if (nome.length === 0 || contaIds.length < MINIMO_CONTAS_AGRUPADOR) erros.push({ campo: nome.length === 0 ? 'nome' : 'contas', mensagem: MSG_MINIMO });
  else if (nome.length > TAMANHO_NOME_AGRUPADOR) erros.push({ campo: 'nome', mensagem: `Use no máximo ${TAMANHO_NOME_AGRUPADOR} caracteres no nome.` });
  if (contaIds.some((c) => !UUID.test(c))) erros.push({ campo: 'contas', mensagem: 'Conta inválida. Recarregue a tela.' });
  return erros.length > 0 ? falha(erros) : ok({ nome, contaIds });
}
