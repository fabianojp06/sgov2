import { configurarProvedorContexto } from '@/shared/authz/configuracao';
import { lerEnvAcesso } from '@/shared/config';
import { criarProvedorContexto } from './provedor-contexto';

let avisouSemProxy = false;

// Chamado uma vez pelo src/instrumentation.ts: liga a guarda do P1 às sessões do aut. Valida as
// variáveis de acesso já no boot (uma URL_PUBLICA errada falha aqui, não em cada requisição).
export function registrarAutenticacao(): void {
  const env = lerEnvAcesso();
  if (process.env.NODE_ENV === 'production' && !env.confiarProxy && !avisouSemProxy) {
    avisouSemProxy = true;
    console.warn('[CONFIAR_PROXY_AUSENTE] sem CONFIAR_PROXY=1, o IP do cliente fica nulo e só vale o limite de login por login');
  }
  configurarProvedorContexto(criarProvedorContexto());
}
