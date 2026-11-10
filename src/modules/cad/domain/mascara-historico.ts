// Máscara dos salários no Histórico de Operações (R24 do P4; contrato pedido pelo P8, D-P8-10): quem
// não tem cad.salarios:consultar vê o Histórico do cadastro de cargos sem os valores que a tela do
// cargo também esconde. Função pura (sem banco nem permissão própria): a tela do Histórico (frente A)
// chama linha a linha com o `antes` e o `depois` gravados e com a permissão da sessão.
//
// Mascarado em cad.cargos: mínimo e máximo de mercado (em claro, mas mascarados na tela, R24), o valor
// manual dos benefícios do cargo e os envelopes cifrados. A tabela salarial (cad.tabela_salarial) não
// mascara: a tela dela mostra mínimo e máximo a quem tem acesso.

export const VALOR_MASCARADO = '•••';

const CHAVES_DE_SALARIO: Readonly<Record<string, ReadonlySet<string>>> = {
  'cad.cargos': new Set([
    'mercadoMinimo',
    'mercadoMaximo',
    'valorManual',
    'salarioRealCifrado',
    'salarioDefinidoCifrado',
    'funcaoGratificadaCifrada',
  ]),
};

export type HistoricoMascarado = { dados: unknown; mascarado: boolean };

/**
 * Devolve uma cópia de `dados` (o `antes` ou o `depois` de uma linha do Histórico) com os valores de
 * salário trocados por VALOR_MASCARADO, em qualquer profundidade (objetos e listas). Com a permissão,
 * ou numa funcionalidade sem salário, devolve os dados como estão. Um valor nulo continua nulo: a
 * máscara não revela se havia valor, só esconde o que havia.
 */
export function mascararHistoricoCad(funcionalidade: string, dados: unknown, podeVerSalarios: boolean): HistoricoMascarado {
  const chaves = CHAVES_DE_SALARIO[funcionalidade];
  if (podeVerSalarios || !chaves) return { dados, mascarado: false };
  let mascarado = false;
  const visitar = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(visitar);
    if (v === null || typeof v !== 'object') return v;
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => {
        if (chaves.has(k) && x !== null && x !== undefined) {
          mascarado = true;
          return [k, VALOR_MASCARADO];
        }
        return [k, visitar(x)];
      }),
    );
  };
  return { dados: visitar(dados), mascarado };
}
