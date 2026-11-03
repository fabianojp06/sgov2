import { z } from 'zod';
import type { ErroCampo } from '@/shared/kernel';

// Mensagens padrão do Zod em português (#177): valem só quando o schema não traz a própria, que
// continua tendo precedência. Ficam nesta chamada, sem z.config global, para não mudar outros usos.
const MENSAGENS_PT = z.locales.ptBR().localeError;

// Validação da entrada das ações (definirAcao e definirAcaoPublica): erros por campo, '_' para a raiz.
export async function validarEntrada<I>(
  esquema: z.ZodType<I>,
  entradaBruta: unknown,
): Promise<{ ok: true; valor: I } | { ok: false; erros: ErroCampo[] }> {
  const validado = await esquema.safeParseAsync(entradaBruta, { error: MENSAGENS_PT });
  if (validado.success) return { ok: true, valor: validado.data };
  return {
    ok: false,
    erros: validado.error.issues.map((i) => ({ campo: i.path.length > 0 ? i.path.join('.') : '_', mensagem: i.message })),
  };
}
