import type { PrismaClient } from '@/generated/prisma/client';
import { obterParametroSistema } from '@/modules/cad/servidor';

// Nome de exibição da instituição para os e-mails (plano do P4, Task 9b; spec §6.7, R10): lido do
// parametro_sistema a cada envio, pelo servidor.ts do cad. Vazio enquanto não cadastrado.
export function criarObterNomeExibicao(cliente: Pick<PrismaClient, '$transaction'>): () => Promise<string> {
  return () => cliente.$transaction((tx) => obterParametroSistema(tx, 'instituicao.nome_exibicao'));
}
