import { notFound } from 'next/navigation';
import { ErroPermissao } from '@/shared/authz';

// Auxiliares das páginas do orc (Server Components).

// Exercício do ?ano= da URL; sem ano válido ou sem esse exercício, o mais recente (a lista vem em
// ordem decrescente de ano).
export function exercicioDoAno<T extends { ano: number }>(exercicios: readonly T[], ano: string | string[] | undefined): T | null {
  const pedido = typeof ano === 'string' && /^\d{4}$/.test(ano) ? Number(ano) : null;
  return exercicios.find((e) => e.ano === pedido) ?? exercicios[0] ?? null;
}

// Negação vinda do caso de uso (escopo, R15): a página responde 404, como a exigirPagina.
export function naoEncontradoSeNegado(erro: unknown): never {
  if (erro instanceof ErroPermissao) notFound();
  throw erro;
}
