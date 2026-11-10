import type { TxCliente } from './prisma';

// Trava por recurso (US-011; spec l.277): advisory lock da transação, solto no commit ou rollback.
// A chave é texto (ex.: 'sync-plano', 'remanejamento:<conta>'); hashtext a leva ao espaço do bigint.
// Depende do READ COMMITTED do projeto: o que vem depois da trava enxerga o que a anterior gravou.
export async function travarRecurso(tx: TxCliente, chave: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chave}))`;
}

// Sem esperar: false se outra transação segura a mesma chave (ex.: lote que fica para depois).
export async function tentarTravarRecurso(tx: TxCliente, chave: string): Promise<boolean> {
  const [r] = await tx.$queryRaw<{ travou: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${chave})) AS travou`;
  return r?.travou === true;
}
