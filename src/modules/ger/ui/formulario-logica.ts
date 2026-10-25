// Lógica pura do Formulario (sem React), testada diretamente.
import type { ErroCampo } from '@/shared/kernel';

export const idErroDoCampo = (campo: string) => `erro-${campo}`;

export function errosDoCampo(erros: readonly ErroCampo[], campo: string): string[] {
  return erros.filter((e) => e.campo === campo).map((e) => e.mensagem);
}
