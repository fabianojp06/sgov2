import { createHash } from 'node:crypto';

// O banco guarda só o SHA-256 do token da sessão.
export const hashDoToken = (token: string) => createHash('sha256').update(token).digest('hex');
