export type ErroCampo = { readonly campo: string; readonly mensagem: string };

export type Resultado<T, E = readonly ErroCampo[]> = { ok: true; valor: T } | { ok: false; erros: E };

export function ok<T>(valor: T): { ok: true; valor: T } {
  return { ok: true, valor };
}

export function falha<E>(erros: E): { ok: false; erros: E } {
  return { ok: false, erros };
}
