import { lerEnvAcesso } from '@/shared/config';
import type { TxCliente } from '@/shared/db';
import {
  validarDadosModelo,
  validarDestinatario,
  VERSAO_ATUAL,
  type DadosModeloEmail,
  type Destinatario,
  type MensagemEmail,
  type ModeloEmail,
} from '../domain/modelos-email';

/**
 * Contrato C4: registra o envio de um e-mail na transação do caso de uso.
 *
 * **Resolver significa "enfileirado", não "entregue".** Com commit, o worker envia depois;
 * com rollback, nada é enviado. A tela não deve dizer "e-mail enviado", e sim "e-mail a caminho".
 *
 * Como funciona (US-025; plano do P4, R8, R9 e R23):
 * - valida o destinatário e os dados do modelo; o link de acesso é exatamente
 *   `${URL_PUBLICA}/login`, sem query, fragmento nem credencial;
 * - registra com `registrarNoOutbox(tx, 'email.enviar', mensagem)` de `@/shared/filas`, carregado
 *   com `await import()` dentro da função: o index.ts do ger também é importado por componentes
 *   cliente, e Prisma, pg e pg-boss não podem ir ao bundle do navegador;
 * - a mensagem leva a versão do modelo (as novas tentativas renderizam igual) e `criadoEm`. O nome
 *   da instituição entra na renderização, de `instituicao.nome_exibicao`, nunca fixo no texto;
 * - o worker envia pelo SMTP externo, com até 3 novas tentativas (EP083, UC0.06 E1), também quando
 *   o servidor recusa o endereço, com o destinatário estruturado (`{ name, address }`);
 * - modelos em `MODELOS_SENSIVEIS`: o `publicarOutbox` (#181) esvazia os dados da linha do outbox
 *   ao publicar, e o trabalhador apaga os dados do job depois do envio, na falha definitiva e
 *   depois de 24 h (`VALIDADE_MENSAGEM_SENSIVEL_MS`, a validade da senha temporária). O reenvio
 *   exige gerar outra senha (redefinição);
 * - a falha definitiva fica visível no Histórico de Operações (tipo SISTEMA), com o modelo e o
 *   destinatário mascarado, nunca a senha. O caminho de recuperação é a redefinição de senha.
 *
 * @throws ErroDominio('email.destinatario_invalido') para destinatário malformado (validado antes de tudo).
 * @throws ErroDominio('email.dados_invalidos') para dado fora do modelo ou link de outra origem.
 */
export async function enviarEmail<M extends ModeloEmail>(
  tx: TxCliente,
  modelo: M,
  destinatario: Destinatario,
  dados: DadosModeloEmail[M],
): Promise<void> {
  validarDestinatario(destinatario);
  validarDadosModelo(modelo, dados, lerEnvAcesso().urlPublica);
  const mensagem = {
    modelo,
    versao: VERSAO_ATUAL[modelo],
    destinatario,
    dados,
    criadoEm: new Date().toISOString(),
  } as MensagemEmail;
  const { registrarNoOutbox } = await import('@/shared/filas');
  await registrarNoOutbox(tx, 'email.enviar', mensagem);
}
