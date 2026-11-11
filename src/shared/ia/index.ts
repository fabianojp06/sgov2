import { prisma } from '@/shared/db';
import { criarServicoIA, type ServicoIA } from './governanca';
import type { ProvedorIA } from './porta';
import { criarProvedorIA } from './provedor';

// Infraestrutura de IA (spec §4.4; US-018 e US-019). Os módulos chamam a IA só pelo servicoIA, que
// aplica a governança (permissão, chaves liga/desliga, limites, teto e registro); o provedor fica
// atrás dele e não sai daqui, para ninguém chamar a IA sem passar pela governança.
// Só no servidor e no worker: o SDK e a chave nunca vão ao navegador.
export {
  ErroIA,
  ESFORCOS_IA,
  MODELO_PADRAO,
  type CodigoErroIA,
  type EsforcoIA,
  type EventoStreamIA,
  type PedidoIA,
  type ProvedorIA,
  type RespostaIA,
  type UsoIA,
} from './porta';
export {
  criarServicoIA,
  DIAS_RETENCAO_TEXTO,
  inicioDoMes,
  instalarCasosUsoIA,
  limparIA,
  MINUTOS_RESERVA,
  SISTEMA_IA,
  type DefinicaoCasoUsoIA,
  type DependenciasServicoIA,
  type QuemPedeIA,
  type ServicoIA,
} from './governanca';
export { MODELOS_IA } from './precos';
// Para os testes dos módulos: um provedor com roteiro, entregue ao criarServicoIA.
export { criarProvedorIAFalso, type ProvedorIAFalso, type RoteiroIAFalso } from './falso';

// O provedor do ambiente (ANTHROPIC_API_KEY) e o cliente sgo_app, ambos criados no primeiro uso.
let provedor: ProvedorIA | undefined;
export const servicoIA: ServicoIA = criarServicoIA({ cliente: prisma, obterProvedor: () => (provedor ??= criarProvedorIA()) });
