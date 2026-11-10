// Máscara dos salários no Histórico de Operações (R24 do P4; contrato pedido pelo P8, D-P8-10): quem
// não tem cad.salarios:consultar vê o Histórico do cadastro de cargos sem os valores que a tela do
// cargo também esconde. Função pura (sem banco nem permissão própria): a tela do Histórico (frente A)
// chama linha a linha com o `antes`, o `depois` e o `delta` gravados e com a permissão da sessão.
// Ver salário sem máscara é consulta auditada (R24): quando `contemSalario` vier true para quem tem a
// permissão, a tela registra um CONSULTA de cad.salarios, como a tela do cargo (registrarConsulta).
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

// mascarado: algum valor foi trocado. contemSalario: havia valor de salário (com ou sem a permissão).
export type HistoricoMascarado = { dados: unknown; mascarado: boolean; contemSalario: boolean };

/**
 * Devolve uma cópia de `dados` (o `antes` ou o `depois` de uma linha do Histórico) com os valores de
 * salário trocados por VALOR_MASCARADO, em qualquer profundidade (objetos e listas). Com a permissão,
 * ou numa funcionalidade sem salário, devolve os dados como estão. Um valor nulo continua nulo: a
 * máscara não revela se havia valor, só esconde o que havia.
 */
export function mascararHistoricoCad(funcionalidade: string, dados: unknown, podeVerSalarios: boolean): HistoricoMascarado {
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
  // Com a permissão, os dados como estão (a mesma referência); a varredura só informa se havia salário.
  if (podeVerSalarios) return { dados, mascarado: false, contemSalario };
  return { dados: mascarados, mascarado: contemSalario, contemSalario };
}
