// Lógica pura do Formulario (sem React), testada diretamente.
import type { ErroCampo } from '@/shared/kernel';

export const idErroDoCampo = (campo: string) => `erro-${campo}`;

export function errosDoCampo(erros: readonly ErroCampo[], campo: string): string[] {
  return erros.filter((e) => e.campo === campo).map((e) => e.mensagem);
}

/**
 * O aria-describedby de um campo depois da resposta (#229): o id `erro-<campo>` entra só com erro
 * (o span só existe com erro) e sai sem erro; as outras descrições do campo ficam. Vazio → null.
 */
export function descricaoDoCampo(atual: string | null, campo: string, temErro: boolean): string | null {
  const id = idErroDoCampo(campo);
  const outros = (atual ?? '').split(/\s+/).filter((t) => t && t !== id);
  const tokens = temErro ? [...outros, id] : outros;
  return tokens.length > 0 ? tokens.join(' ') : null;
}
