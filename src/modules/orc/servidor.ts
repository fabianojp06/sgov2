// Entrada só de servidor do orc (plano do P4, R22): worker, seed e casos de uso de outros módulos.
// Páginas e componentes usam o index.ts (o lint proíbe app/ e ui/ de importar este arquivo).
// Nada aqui importa @/shared/authz nem next/ (o worker/bundle.test.ts reprova).
import type { PrismaClient } from '@/generated/prisma/client';
import type { FilaGerenciada } from '@/shared/filas';
import { registrarTrabalhadorRevisor } from './infrastructure/trabalhador-revisor';

// Avaliação de qualidade da sugestão de conta (US-062, #403): o worker registra o avaliador na fila
// ia.avaliar do int, com o código do caso como chave.
export { CASOS_IA_ORC } from './application/ia-casos';
export { avaliadorSugestaoConta } from './infrastructure/avaliacao/avaliador';

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
