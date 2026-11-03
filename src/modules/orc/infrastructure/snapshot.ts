import { createHash } from 'node:crypto';
import { Dinheiro, Percentual } from '@/shared/kernel';

// Snapshot imutável da oficialização (§6.2, R10): JSON canônico (chaves em ordem, Dinheiro e
// Percentual como string decimal, datas em ISO) e o sha256 dele, para conferência futura.
function canonico(v: unknown): unknown {
  if (v instanceof Dinheiro || v instanceof Percentual) return v.paraString();
  if (v instanceof Date) return v.toISOString();
  // Outras classes com valor (ex.: Prisma.Decimal): o valor serializado, nunca os campos internos.
  if (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && typeof (v as { toJSON?: unknown }).toJSON === 'function') {
    return canonico((v as { toJSON(): unknown }).toJSON());
  }
  if (Array.isArray(v)) return v.map(canonico);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonico((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

export function montarSnapshot(dados: unknown): { conteudo: unknown; sha256: string } {
  const conteudo = canonico(dados);
  return { conteudo, sha256: createHash('sha256').update(JSON.stringify(conteudo)).digest('hex') };
}

// Conferência do snapshot gravado (decisão do PO de 03/11): o jsonb do banco reordena as chaves e muda
// os espaços, então o sha256 não se confere direto no SQL. Relido pelo app, o conteúdo volta ao JSON
// canônico e o hash tem de ser o mesmo.
export function conferirSnapshot(conteudo: unknown, sha256: string): boolean {
  return createHash('sha256').update(JSON.stringify(canonico(conteudo))).digest('hex') === sha256;
}
