import { lerAmbiente, type Ambiente } from '@/modules/ger/servidor';
import { lerEnvAcesso } from '@/shared/config';

// Configuração de partida do worker (plano do P4, R25 e M-n5): falha antes de abrir conexões.
// - AMBIENTE: obrigatório na imagem (NODE_ENV=production);
// - URL_PUBLICA: a mesma regra do app (lerEnvAcesso). O e-mail só aceita link `${URL_PUBLICA}/login`;
//   uma divergência com a do app aparece como e-mail recusado no Histórico, nunca como link errado.
// As mensagens citam só o nome da variável.
export function lerConfiguracaoWorker(fonte: Readonly<Record<string, string | undefined>> = process.env): {
  ambiente: Ambiente;
  urlPublica: string;
} {
  const ambiente = lerAmbiente(fonte);
  let urlPublica: string;
  try {
    urlPublica = lerEnvAcesso(fonte).urlPublica;
  } catch (erro) {
    const ausente = !fonte.URL_PUBLICA?.trim();
    throw new Error(`${ausente ? '[URL_PUBLICA_AUSENTE]' : '[URL_PUBLICA_INVALIDA]'} ${(erro as Error).message}`, { cause: erro });
  }
  return { ambiente, urlPublica };
}
