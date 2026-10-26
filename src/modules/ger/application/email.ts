import { lerEnvAcesso } from '@/shared/config';
import type { TxCliente } from '@/shared/db';
// Direto do outbox.ts, e não do index do @/shared/filas: o index também exporta o pg-boss, e este
// arquivo vai ao bundle do navegador pelo index.ts do ger (bundle-cliente.test.ts). Em tempo de
// execução, o outbox.ts só usa o kernel.
import { registrarNoOutbox } from '@/shared/filas/outbox';
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
 * - valida o destinatário e os dados do modelo. **Limites que o consumidor deve respeitar no
 *   próprio formulário**, para o cadastro não falhar no envio:
 *   - `destinatario.email` até 254 caracteres; `destinatario.nome` sem `< > , ; "`;
 *   - `dados.nome` até 120, `dados.login` até 100, `dados.senhaTemporaria` até 128 caracteres, não
 *     vazios;
 *   - nenhum texto com caractere de controle (quebra de linha, tabulação, C1, bidi);
 *   - `dados.urlAcesso` exatamente `${lerEnvAcesso().urlPublica}/login` (use o `lerEnvAcesso`, que
 *     normaliza a origem; não monte a partir do `process.env` cru);
 * - registra com `registrarNoOutbox(tx, 'email.enviar', mensagem)`, do `outbox.ts` de
 *   `@/shared/filas`: o index.ts do ger também é importado por componentes cliente, e Prisma, pg e
 *   pg-boss não podem ir ao bundle do navegador (nem por import dinâmico);
 * - a mensagem leva a versão do modelo (as novas tentativas renderizam igual) e `criadoEm`. O nome
 *   da instituição entra na renderização, de `instituicao.nome_exibicao`, nunca fixo no texto;
 * - o worker envia pelo SMTP externo, com até 3 novas tentativas (EP083, UC0.06 E1), também quando
 *   o servidor recusa o endereço, com o destinatário estruturado (`{ name, address }`);
 * - grava só os campos do modelo e do destinatário, nunca chaves a mais do objeto recebido;
 * - modelos em `MODELOS_SENSIVEIS`: o `publicarOutbox` (#181) esvazia os dados da linha do outbox
 *   ao publicar, e o trabalhador apaga os dados do job depois do envio, na falha definitiva e
 *   depois de 24 h (`VALIDADE_MENSAGEM_SENSIVEL_MS`, a validade da senha temporária). A linha de
 *   outbox abandonada (`MAX_TENTATIVAS_OUTBOX`) só acontece com fila desconhecida ou chave
 *   inválida, o que não ocorre com `email.enviar`. O reenvio exige gerar outra senha (redefinição);
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
  const { nome, login, senhaTemporaria, urlAcesso } = dados;
  const mensagem = {
    modelo,
    versao: VERSAO_ATUAL[modelo],
    destinatario: destinatario.nome === undefined ? { email: destinatario.email } : { email: destinatario.email, nome: destinatario.nome },
    dados: { nome, login, senhaTemporaria, urlAcesso },
    criadoEm: new Date().toISOString(),
  } as MensagemEmail;
  await registrarNoOutbox(tx, 'email.enviar', mensagem);
}
