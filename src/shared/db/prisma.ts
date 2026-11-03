import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '@/generated/prisma/client';
import { lerEnv } from '@/shared/config/env';

export type TxCliente = Prisma.TransactionClient;

export function criarPrisma(url: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

// Singleton preguiçoso: só conecta no primeiro uso, sempre com DATABASE_URL (sgo_app).
// Fica no globalThis para o hot reload do Next.js não abrir um pool por recarga.
const global_ = globalThis as typeof globalThis & { __sgoPrisma?: PrismaClient };

function instancia(): PrismaClient {
  global_.__sgoPrisma ??= criarPrisma(lerEnv().DATABASE_URL);
  return global_.__sgoPrisma;
}

// Só o acesso a um membro do cliente instancia. "then" (await prisma, Promise.resolve(prisma)) não:
// antes, instanciava fora de hora ou falhava sem DATABASE_URL. O "in" consulta o cliente real. (O
// util.inspect do Node já formata o alvo do Proxy sem passar pelas armadilhas.)
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  has(_alvo, prop) {
    return Reflect.has(instancia(), prop);
  },
  get(_alvo, prop) {
    if (prop === 'then') return undefined;
    const cliente = instancia();
    const valor = Reflect.get(cliente, prop, cliente) as unknown;
    return typeof valor === 'function' ? (valor as (...a: unknown[]) => unknown).bind(cliente) : valor;
  },
});
