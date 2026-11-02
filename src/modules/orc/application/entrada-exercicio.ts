import { z } from 'zod';

// Entradas das ações de exercício (Task 3). A conversão do FormData fica aqui; a validação dos
// campos é do caso de uso, que confere a ORIGEM BLINDADA no payload bruto antes do parse estrito.
const comoObjeto = (v: unknown) => (v instanceof FormData ? Object.fromEntries([...v.keys()].map((k) => [k, v.get(k)])) : v);

export const entradaBruta = z.preprocess(comoObjeto, z.record(z.string(), z.unknown()));

const MENSAGEM_VERSAO = 'Versão do registro inválida. Recarregue a tela.';

export const entradaVersionada = z.preprocess(
  comoObjeto,
  z.object({
    id: z.string(),
    versao: z
      .string()
      .regex(/^\d{1,9}$/, MENSAGEM_VERSAO)
      .transform(Number),
  }),
);
