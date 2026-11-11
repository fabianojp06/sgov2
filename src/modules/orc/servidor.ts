// Entrada só de servidor do orc (plano do P4, R22): worker, seed e casos de uso de outros módulos.
// Páginas e componentes usam o index.ts (o lint proíbe app/ e ui/ de importar este arquivo).
// Nada aqui importa @/shared/authz nem next/ (o worker/bundle.test.ts reprova).
import type { PrismaClient } from '@/generated/prisma/client';
import type { FilaGerenciada } from '@/shared/filas';
import { registrarTrabalhadorRevisor } from './infrastructure/trabalhador-revisor';

/**
 * Registra os trabalhadores do orc no worker: o do revisor antes do envio (fila orc.revisar, US-064). A
 * IA vai pelo servicoIA padrão, com o cliente do app; as leituras do orçamento, pelo cliente do worker.
 */
export async function registrarTrabalhadoresOrc(fila: FilaGerenciada, deps: { cliente: PrismaClient }): Promise<void> {
  await registrarTrabalhadorRevisor(fila, { cliente: deps.cliente });
}
