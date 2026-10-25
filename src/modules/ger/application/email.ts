import type { TxCliente } from '@/shared/db';
import { ErroDominio } from '@/shared/kernel';
import { validarDestinatario, type DadosModeloEmail, type Destinatario, type ModeloEmail } from '../domain/modelos-email';

/**
 * Contrato C4: registra o envio de um e-mail na transação do caso de uso.
 *
 * **Resolver significa "enfileirado", não "entregue".** Com commit, o worker envia depois;
 * com rollback, nada é enviado. A tela não deve dizer "e-mail enviado", e sim "e-mail a caminho".
 *
 * Regras que a implementação real (US-025) cumpre:
 * - registra com `registrarNoOutbox(tx, 'email.enviar', …)` de `@/shared/filas`, carregado com
 *   `await import()` dentro da função: o index.ts do ger também é importado por componentes
 *   cliente, e Prisma, pg e pg-boss não podem ir ao bundle do navegador;
 * - grava no payload a versão do modelo, para as novas tentativas renderizarem igual; o nome da
 *   instituição vem de `instituicao.nome_exibicao` na renderização, nunca fixo no texto;
 * - o worker envia pelo SMTP externo, com até 5 tentativas, passando o destinatário estruturado
 *   (`{ name, address }`), nunca uma string montada;
 * - modelos em `MODELOS_SENSIVEIS`: o `publicarOutbox` (#181) já esvazia os dados da linha do
 *   outbox ao publicar; a US-025 apaga os dados do job depois do envio e na falha definitiva, e
 *   os da linha do outbox abandonada (`MAX_TENTATIVAS_OUTBOX`), que hoje ficam. Mudar o
 *   `publicarOutbox` para isso é da frente A (`src/shared/filas/`): por pedido ou com a label
 *   `toca-outra-frente`. O reenvio exige gerar outra senha (redefinição). Recomendação registrada
 *   no PR #184: cifrar esses dados antes do outbox, com a chave só nas variáveis do Easypanel,
 *   porque o WAL e os backups guardam o que passou pelo banco;
 * - a falha definitiva fica visível: registro no Histórico de Operações (tipo SISTEMA) com o
 *   modelo e o destinatário mascarado. O caminho de recuperação é a redefinição de senha.
 *
 * Até a US-025 estar na main, só o falso (`emailFalso`) funciona: o real valida o destinatário
 * e lança `ErroDominio('email.indisponivel')`, porque ainda não há trabalhador de e-mail e uma
 * mensagem enfileirada ficaria parada sem ninguém saber.
 *
 * @throws ErroDominio('email.destinatario_invalido') para destinatário malformado (validado antes de tudo).
 */
export async function enviarEmail<M extends ModeloEmail>(
  tx: TxCliente,
  modelo: M,
  destinatario: Destinatario,
  dados: DadosModeloEmail[M],
): Promise<void> {
  validarDestinatario(destinatario);
  void tx;
  void dados;
  throw new ErroDominio('email.indisponivel', 'Envio de e-mail ainda não disponível (depende da US-025).', {
    modelo,
  });
}
