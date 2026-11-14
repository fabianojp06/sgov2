import type { TxCliente } from '@/shared/db';
import { lerClassificacoes, PAPEIS_CONTA_RELATORIO, type PapelContaRelatorio } from '../domain/contas-relatorio';
import { obterParametroSistema } from './parametro-sistema';

// Leitura das sintéticas marcadas para os relatórios (US-097): as classificações, em ordem. Recebe o tx, sem guarda:
// a permissão é de quem chama. Vazio quando a GFIN ainda não marcou nenhuma.

export async function sinteticasDoRelatorio(tx: TxCliente, papel: PapelContaRelatorio): Promise<readonly string[]> {
  return lerClassificacoes(await obterParametroSistema(tx, PAPEIS_CONTA_RELATORIO[papel].chave));
}
