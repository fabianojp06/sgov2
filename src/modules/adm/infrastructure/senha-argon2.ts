import { hash, verify } from '@node-rs/argon2';

// Argon2id com os parâmetros mínimos do OWASP (RNF0004): 19 MiB, 2 iterações, 1 via.
// O algoritmo 2 é o Argon2id no enum do @node-rs/argon2 (const enum, não importável com isolatedModules).
const OPCOES = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashSenha(senha: string): Promise<string> {
  return hash(senha, OPCOES);
}

// A comparação é de tempo constante na biblioteca. Hash ilegível vale como senha errada: a
// falha não pode virar exceção que diferencie o caminho do login (RNF0005).
export async function conferirSenha(hashGravado: string, senha: string): Promise<boolean> {
  try {
    return await verify(hashGravado, senha);
  } catch {
    return false;
  }
}
