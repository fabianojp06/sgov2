import type { TxCliente } from '@/shared/db';
import { ErroDominio } from '@/shared/kernel';
import { validarDestinatario, type DadosModeloEmail, type Destinatario, type ModeloEmail } from '../domain/modelos-email';

/**
 * Contrato C4: registra o envio de um e-mail na transação do caso de uso.
 * Commit → o worker envia; rollback → nada é enviado (outbox, P1 Tarefa 9).
 *
 * Regras que a implementação real (US-025) cumpre:
 * - registra com `registrarNoOutbox(tx, 'email.enviar', …)` de `@/shared/filas` (US-010);
 * - o worker envia pelo SMTP externo, com até 5 tentativas;
 * - os modelos são versionados, sem nome de instituição fixo (o nome vem de `instituicao.nome_exibicao`);
 * - os dados dos modelos em `MODELOS_SENSIVEIS` são apagados do outbox e do job depois do envio.
 *
 * Até a US-010 estar na main, só o falso (`emailFalso`) funciona: o real valida o destinatário
 * e lança `ErroDominio('email.indisponivel')`.
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
  throw new ErroDominio('email.indisponivel', 'Envio de e-mail ainda não disponível (depende da US-010 e da US-025).', {
    modelo,
  });
}
