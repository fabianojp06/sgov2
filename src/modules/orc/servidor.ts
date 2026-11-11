// Entrada só de servidor do orc (plano do P4, R22): worker, seed e casos de uso de outros módulos.
// Páginas e componentes usam o index.ts (o lint proíbe app/ e ui/ de importar este arquivo).
// Nada aqui importa @/shared/authz nem next/ (o worker/bundle.test.ts reprova).
import type { PrismaClient } from '@/generated/prisma/client';
import type { FilaGerenciada } from '@/shared/filas';
import type { AvaliadorCasoIA } from '@/shared/ia';
import { CASOS_IA_ORC } from './application/ia-casos';
import { avaliadorSugestaoConta } from './infrastructure/avaliacao/avaliador';
import { registrarTrabalhadorRevisor } from './infrastructure/trabalhador-revisor';

// Avaliadores dos casos de IA do orc (fila ia.avaliar do int; US-062, #403), com o código do caso como
// chave. O worker os entrega ao registrarTrabalhadoresInt; um caso novo entra só aqui.
export const AVALIADORES_IA_ORC: Readonly<Record<string, AvaliadorCasoIA>> = {
  [CASOS_IA_ORC.sugestaoConta.codigo]: avaliadorSugestaoConta,
};

// Layout da planilha-modelo ADMC-ORC v1.0 (US-121): o gerador dos 5 exercícios da carga (P7, frente B,
// pedido na #138) usa os mesmos cabeçalhos da importação, sem copiá-los. Constantes puras do domínio.
export {
  ABA_INSTRUCOES,
  ABAS,
  CELULA_LAYOUT,
  COLUNAS_PACOTES,
  COLUNAS_PESSOAL,
  COLUNAS_RECEITAS,
  LAYOUT,
  LINHA_CABECALHO_MAX,
  RAIZES_CONTAS_PESSOAL,
  type Aba,
} from './domain/planilha';

/**
 * Registra os trabalhadores do orc no worker: o do revisor antes do envio (fila orc.revisar, US-064). A
 * IA vai pelo servicoIA padrão, com o cliente do app; as leituras do orçamento, pelo cliente do worker.
 */
export async function registrarTrabalhadoresOrc(fila: FilaGerenciada, deps: { cliente: PrismaClient }): Promise<void> {
  await registrarTrabalhadorRevisor(fila, { cliente: deps.cliente });
}
