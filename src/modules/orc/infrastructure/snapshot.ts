import { createHash } from 'node:crypto';
import { Dinheiro, Percentual } from '@/shared/kernel';

// Snapshot imutável da oficialização (§6.2, R10): JSON canônico (chaves em ordem, Dinheiro e
// Percentual como string decimal, datas em ISO) e o sha256 dele, para conferência futura.
function canonico(v: unknown): unknown {
  if (v instanceof Dinheiro || v instanceof Percentual) return v.paraString();
  if (v instanceof Date) return v.toISOString();
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
