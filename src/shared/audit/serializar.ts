import Decimal from 'decimal.js';
import { Competencia, Dinheiro, ErroDominio, Percentual } from '@/shared/kernel';

// Converte o valor para algo que JSON.stringify grava sem erro e sem perder precisão
// (Review Focus 5): Decimal e os tipos do kernel viram texto exato, Date vira ISO 8601,
// BigInt vira texto. Campos undefined somem; referência circular vira "[circular]".
// Só objetos simples e listas são percorridos: Map, Set, instâncias de classe, Buffer,
// funções, symbol e números não finitos são recusados, para nada sumir em silêncio.
// Credenciais são omitidas em qualquer nível (LGPD): a tabela é imutável.
//
// Convenção: audite valores monetários como Dinheiro/Percentual. Um Decimal cru vem com a
// escala de origem ("1234.5" do banco × "1234.50" do Dinheiro) e geraria delta falso.
const CHAVE_SENSIVEL = /senha|password|passwd|hash|token|segredo|secret|totp|api_?key|credencia/i;

export function serializarParaAuditoria(v: unknown): unknown {
  return serializar(v, '$', new WeakSet());
}

function recusar(caminho: string, motivo: string): never {
  throw new ErroDominio('AUDITORIA_NAO_SERIALIZAVEL', `Valor não serializável para auditoria em ${caminho}: ${motivo}`, {
    caminho,
  });
}

function serializar(v: unknown, caminho: string, vistos: WeakSet<object>): unknown {
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
    if (typeof toJSON === 'function') return serializar(toJSON.call(v), caminho, vistos);
    return recusar(caminho, `objeto ${(v as object).constructor?.name ?? 'sem tipo'}`);
  }
  vistos.add(v);
  try {
    if (Array.isArray(v)) return v.map((item, i) => serializar(item, `${caminho}[${i}]`, vistos));
    if (typeof (v as { toJSON?: unknown }).toJSON === 'function') {
      return serializar((v as { toJSON(): unknown }).toJSON(), caminho, vistos);
    }
    const saida: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [chave, valor] of Object.entries(v)) {
      if (valor === undefined) continue;
      saida[chave] = CHAVE_SENSIVEL.test(chave) ? '[omitido]' : serializar(valor, `${caminho}.${chave}`, vistos);
    }
    return { ...saida };
  } finally {
    vistos.delete(v);
  }
}
