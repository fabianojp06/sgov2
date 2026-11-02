import { z } from 'zod';

// Entradas das ações de exercício (Task 3). A conversão do FormData fica aqui; a validação dos
// campos é do caso de uso, que confere a ORIGEM BLINDADA no payload bruto antes do parse estrito.
const comoObjeto = (v: unknown) => (v instanceof FormData ? Object.fromEntries([...v.keys()].map((k) => [k, v.get(k)])) : v);

export const entradaBruta = z.preprocess(comoObjeto, z.record(z.string(), z.unknown()));
