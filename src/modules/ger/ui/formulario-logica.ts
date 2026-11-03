// Lógica pura do Formulario (sem React), testada diretamente.
import type { ErroCampo } from '@/shared/kernel';

export const idErroDoCampo = (campo: string) => `erro-${campo}`;

export function errosDoCampo(erros: readonly ErroCampo[], campo: string): string[] {
  return erros.filter((e) => e.campo === campo).map((e) => e.mensagem);
}

/** O mínimo de um elemento do DOM que o ajuste do aria usa (testável com objeto falso). */
export type ElementoAria = {
  readonly tagName: string;
  getAttribute(nome: string): string | null;
  setAttribute(nome: string, valor: string): void;
  removeAttribute(nome: string): void;
};

const PREFIXO = idErroDoCampo('');
// Marca do aria-invalid posto pelo Formulario: ele só tira o que ele mesmo pôs.
const MARCA = 'data-invalido-formulario';
// Opções de um grupo: o erro vai no fieldset do grupo (ARIA: aria-invalid não vale para radio).
const OPCAO = new Set(['radio', 'checkbox', 'hidden']);

/**
 * Ajusta o aria dos elementos do form depois da resposta (#229):
 * - em todo aria-describedby, o token `erro-<campo>` fica só se o campo tem erro (o span só existe
 *   com erro), inclusive em fieldset sem name que a tela descreveu por conta própria;
 * - o campo (ou fieldset) com name e com erro recebe o `erro-<campo>` e aria-invalid; radio,
 *   checkbox e hidden não (o grupo é descrito pelo fieldset);
 * - o aria-invalid só é tirado se foi o Formulario que pôs.
 */
export function aplicarAria(elementos: Iterable<ElementoAria>, erros: readonly ErroCampo[]): void {
  const comErro = new Set(erros.map((e) => e.campo).filter((c) => c !== ''));
  for (const el of elementos) {
    const nome = el.getAttribute('name');
    const tipo = (el.getAttribute('type') ?? '').toLowerCase();
    const alvo = nome !== null && nome !== '' && !OPCAO.has(tipo) ? nome : null;
    const tokens = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((t) => t && (!t.startsWith(PREFIXO) || comErro.has(t.slice(PREFIXO.length))));
    if (alvo !== null && comErro.has(alvo) && !tokens.includes(idErroDoCampo(alvo))) tokens.push(idErroDoCampo(alvo));
    if (tokens.length > 0) el.setAttribute('aria-describedby', tokens.join(' '));
    else el.removeAttribute('aria-describedby');
    if (alvo !== null && comErro.has(alvo)) {
      el.setAttribute('aria-invalid', 'true');
      el.setAttribute(MARCA, '');
    } else if (el.getAttribute(MARCA) !== null) {
      el.removeAttribute('aria-invalid');
      el.removeAttribute(MARCA);
    }
  }
}
