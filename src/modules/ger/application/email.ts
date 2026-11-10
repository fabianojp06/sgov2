import { lerEnvAcesso } from '@/shared/config';
import type { TxCliente } from '@/shared/db';
// Direto do outbox.ts, e não do index do @/shared/filas: o index também exporta o pg-boss, e este
// arquivo vai ao bundle do navegador pelo index.ts do ger (bundle-cliente.test.ts). Em tempo de
// execução, o outbox.ts só usa o kernel.
import { registrarNoOutbox } from '@/shared/filas/outbox';
import {
  dadosDoModelo,
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
 *     vazios; no de exportação, `dados.titulo` até 120 e `dados.resultado` `pronta` ou `falhou`;
 *   - no alerta de tentativas: `dados.nomeAdministrador` e `dados.nomeUsuario` até 120, `dados.login`
 *     até 100 e `dados.dataHora` até 40 caracteres, não vazios; `dados.tentativas` inteiro de 1 a
 *     1000; `dados.bloqueado` booleano;
 *   - nenhum texto com caractere de controle (quebra de linha, tabulação, C1, bidi);
 *   - `dados.urlAcesso` exatamente `${lerEnvAcesso().urlPublica}` mais o caminho do modelo (`/login`
 *     nos de senha, `/rel/exportacoes` no de exportação, `/adm/usuarios` no alerta de tentativas;
 *     use o `lerEnvAcesso`, que
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
  const mensagem = {
    modelo,
    versao: VERSAO_ATUAL[modelo],
    destinatario: destinatario.nome === undefined ? { email: destinatario.email } : { email: destinatario.email, nome: destinatario.nome },
    dados: dadosDoModelo(modelo, dados),
    criadoEm: new Date().toISOString(),
  } as MensagemEmail;
  await registrarNoOutbox(tx, 'email.enviar', mensagem);
}
