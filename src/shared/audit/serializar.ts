import Decimal from 'decimal.js';
import { Competencia, Dinheiro, Percentual } from '@/shared/kernel';
import { ErroAuditoria } from './erros';

// Converte o valor para algo que JSON.stringify grava sem erro e sem perder precisão
// (Review Focus 5): Decimal e os tipos do kernel viram texto exato, Date vira ISO 8601,
// BigInt vira texto. Campos undefined somem; referência circular vira "[circular]".
// Só objetos simples e listas são percorridos: Map, Set, instâncias de classe, Buffer,
// funções, symbol e números não finitos são recusados, para nada sumir em silêncio.
// Credenciais são omitidas em qualquer nível (LGPD): a tabela é imutável.
//
// Convenção: audite valores monetários como Dinheiro/Percentual. Um Decimal cru vem com a
// escala de origem ("1234.5" do banco × "1234.50" do Dinheiro) e geraria delta falso.
export const CHAVE_SENSIVEL = /senha|password|passwd|hash|token|segredo|secret|totp|api_?key|credencia/i;
export const OMITIDO = '[omitido]';
export const OMITIDO_ALTERADO = '[omitido: alterado]';

export function serializarParaAuditoria(v: unknown): unknown {
  return serializar(v, '$', new WeakSet());
}

function recusar(caminho: string, motivo: string): never {
  throw new ErroAuditoria('AUDITORIA_NAO_SERIALIZAVEL', `Valor não serializável para auditoria em ${caminho}: ${motivo}`, {
    caminho,
  });
}

// Saltos de toJSON seguidos no mesmo caminho: um toJSON que devolve algo com outro toJSON, em ciclo
// (uma classe, duas classes ou objeto simples), giraria sem fim. Acima do limite, recusa com o caminho.
const MAXIMO_SALTOS_TOJSON = 8;

function serializar(v: unknown, caminho: string, vistos: WeakSet<object>, saltos = 0): unknown {
  if (v === null || v === undefined || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : recusar(caminho, 'número não finito');
  if (typeof v === 'bigint') return v.toString();
  if (typeof v !== 'object') return recusar(caminho, typeof v);
  if (v instanceof Dinheiro || v instanceof Percentual) return v.paraString();
  if (v instanceof Competencia) return v.formatar();
  if (Decimal.isDecimal(v)) return (v as Decimal).toFixed();
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? recusar(caminho, 'data inválida') : v.toISOString();
  if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return recusar(caminho, 'dado binário');
  if (vistos.has(v)) return '[circular]';
  const prototipo = Object.getPrototypeOf(v) as unknown;
  const simples = Array.isArray(v) || prototipo === Object.prototype || prototipo === null;
  if (!simples) {
    const toJSON = (v as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === 'function') return seguirToJSON(toJSON.call(v), caminho, vistos, saltos);
    return recusar(caminho, `objeto ${(v as object).constructor?.name ?? 'sem tipo'}`);
  }
  vistos.add(v);
  try {
    if (Array.isArray(v)) return v.map((item, i) => serializar(item, `${caminho}[${i}]`, vistos));
    if (typeof (v as { toJSON?: unknown }).toJSON === 'function') {
      return seguirToJSON((v as { toJSON(): unknown }).toJSON(), caminho, vistos, saltos);
    }
    const saida: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [chave, valor] of Object.entries(v)) {
      if (valor === undefined) continue;
      saida[chave] = CHAVE_SENSIVEL.test(chave) ? OMITIDO : serializar(valor, `${caminho}.${chave}`, vistos);
    }
    return { ...saida };
  } finally {
    vistos.delete(v);
  }
}

function seguirToJSON(json: unknown, caminho: string, vistos: WeakSet<object>, saltos: number): unknown {
  if (saltos >= MAXIMO_SALTOS_TOJSON) return recusar(caminho, 'toJSON recursivo');
  return serializar(json, caminho, vistos, saltos + 1);
}

// Credencial que mudou: os dois lados viram [omitido] e o delta não mostraria a troca. Compara os
// originais (antes da serialização) e marca o depois com [omitido: alterado], sem gravar valor nenhum.
// Percorre só objetos simples presentes nos dois lados, na mesma forma do serializado.
export function marcarCredenciaisAlteradas(antesOriginal: unknown, depoisOriginal: unknown, depoisSerializado: unknown): unknown {
  if (!simplesPlano(antesOriginal) || !simplesPlano(depoisOriginal) || !simplesPlano(depoisSerializado)) return depoisSerializado;
  const saida: Record<string, unknown> = { ...depoisSerializado };
  for (const chave of Object.keys(saida)) {
    if (!Object.hasOwn(antesOriginal, chave)) continue;
    if (CHAVE_SENSIVEL.test(chave)) {
      if (saida[chave] === OMITIDO && !mesmoValor(antesOriginal[chave], depoisOriginal[chave])) saida[chave] = OMITIDO_ALTERADO;
    } else {
      saida[chave] = marcarCredenciaisAlteradas(antesOriginal[chave], depoisOriginal[chave], saida[chave]);
    }
  }
  return saida;
}

function simplesPlano(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v) as unknown;
  return p === Object.prototype || p === null;
}

function mesmoValor(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
