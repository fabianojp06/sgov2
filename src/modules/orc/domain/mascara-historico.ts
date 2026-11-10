// Máscara do salário das posições de pessoal no Histórico de Operações (US-056; plano do P12,
// D-P12-4). O Histórico grava a posição inteira, com o salário; quem não tem orc.posicoes com
// incluir ou alterar (DIREX, Auditor, Administrador) não pode vê-lo. Função pura, no formato de
// mascararHistoricoCad (contrato do cad, D-P8-10): a futura tela de detalhe do Histórico a compõe na
// camada app (o adm não importa o orc, para não fechar ciclo com orc → adm). Hoje a consulta do
// Histórico não mostra antes/depois, então nada vaza.

// O mesmo texto do VALOR_MASCARADO do cad (o domain não importa outro módulo; o teste da página confere).
export const VALOR_MASCARADO = '•••';

const CHAVES_DE_SALARIO: Readonly<Record<string, ReadonlySet<string>>> = {
  'orc.posicoes': new Set(['salarioMensal']),
};

// mascarado: algum valor foi trocado. contemSalario: havia valor de salário (com ou sem a permissão).
export type HistoricoMascaradoOrc = { dados: unknown; mascarado: boolean; contemSalario: boolean };

/**
 * Devolve uma cópia de `dados` (o `antes` ou o `depois` de uma linha do Histórico) com o salário
 * trocado por VALOR_MASCARADO, em qualquer profundidade (objetos e listas). Com a permissão, ou numa
 * funcionalidade sem salário, devolve os dados como estão. Um valor nulo continua nulo.
 */
export function mascararHistoricoOrc(funcionalidade: string, dados: unknown, podeVerSalarios: boolean): HistoricoMascaradoOrc {
  const chaves = CHAVES_DE_SALARIO[funcionalidade];
  if (!chaves) return { dados, mascarado: false, contemSalario: false };
  let contemSalario = false;
  const visitar = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(visitar);
    if (v === null || typeof v !== 'object') return v;
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => {
        if (chaves.has(k) && x !== null && x !== undefined) {
          contemSalario = true;
          return [k, VALOR_MASCARADO];
        }
        return [k, visitar(x)];
      }),
    );
  };
  const mascarados = visitar(dados);
  if (podeVerSalarios) return { dados, mascarado: false, contemSalario };
  return { dados: mascarados, mascarado: contemSalario, contemSalario };
}
