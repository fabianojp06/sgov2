import type { UsoIA } from './porta';

// Custo estimado de uma chamada (US-019, spec §4.4), para o registro e o teto mensal. Preço de lista
// da API em centavos de dólar por milhão de tokens: um centavo por milhão é 1e-8 dólar por token, então
// o custo sai em inteiros de 1e-8 dólar, exato (dinheiro não passa por number). A escrita em cache é a
// de 5 minutos (1,25 vez a entrada), a única que o adaptador usa. Modelo fora da tabela (um fallback
// novo, por exemplo) paga o preço do mais caro: o teto erra para o lado seguro.
type Preco = { entrada: bigint; saida: bigint; cacheLeitura: bigint; cacheEscrita: bigint };

const PRECOS: Readonly<Record<string, Preco>> = {
  'claude-opus-5-5': { entrada: 400n, saida: 2000n, cacheLeitura: 20n, cacheEscrita: 500n },
  'claude-opus-5': { entrada: 500n, saida: 2500n, cacheLeitura: 50n, cacheEscrita: 625n },
  'claude-fable-5-1': { entrada: 1000n, saida: 5000n, cacheLeitura: 25n, cacheEscrita: 1250n },
};
const MAIS_CARO = PRECOS['claude-fable-5-1']!;

const CASAS = 8;
const ESCALA = 10n ** BigInt(CASAS);

/** Custo em unidades de 1e-8 dólar. */
export function custoEmUnidades(modelo: string, uso: UsoIA): bigint {
  const p = PRECOS[modelo] ?? MAIS_CARO;
  return (
    BigInt(uso.entrada) * p.entrada + BigInt(uso.saida) * p.saida + BigInt(uso.cacheLeitura) * p.cacheLeitura + BigInt(uso.cacheEscrita) * p.cacheEscrita
  );
}

/** Unidades de 1e-8 dólar em texto decimal com 8 casas ("0.00123400"), para o NUMERIC(16,8). */
export function unidadesParaUsd(u: bigint): string {
  const inteiro = u / ESCALA;
  const fracao = (u % ESCALA).toString().padStart(CASAS, '0');
  return `${inteiro}.${fracao}`;
}

/** Texto decimal do banco ("12.5", "0.00123400") em unidades de 1e-8 dólar; mais de 8 casas é erro. */
export function usdParaUnidades(texto: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,8}))?$/.exec(texto.trim());
  if (!m) throw new Error(`valor em dólar inválido: ${texto}`);
  return BigInt(m[1]!) * ESCALA + BigInt((m[2] ?? '').padEnd(CASAS, '0'));
}
