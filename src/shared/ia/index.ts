// Infraestrutura de IA (spec §4.4; US-018): a porta ProvedorIA e os adaptadores. Os módulos usam a
// porta e o criarProvedorIA; o adaptador Anthropic só é criado pela fábrica, com a chave do ambiente
// (não sai daqui, para ninguém contornar a regra de produção sem chave).
// Só no servidor e no worker: o SDK e a chave nunca vão ao navegador.
export {
  ErroIA,
  MODELO_PADRAO,
  type CodigoErroIA,
  type EsforcoIA,
  type EventoStreamIA,
  type PedidoIA,
  type ProvedorIA,
  type RespostaIA,
  type UsoIA,
} from './porta';
export { criarProvedorIA } from './provedor';
export { criarProvedorIAFalso, type ProvedorIAFalso, type RoteiroIAFalso } from './falso';
