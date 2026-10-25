import { ErroDominio } from '@/shared/kernel';
import { temCaractereDeControle } from './texto';

// Contrato C4: modelos de e-mail e os dados de cada um. Novo modelo = nova chave em
// DadosModeloEmail e em SENSIBILIDADE_MODELO (sem a classificação, não compila); acrescentar
// chave não quebra os consumidores. O texto dos modelos não leva nome de instituição fixo:
// o nome vem de instituicao.nome_exibicao (spec §6.7).
export type DadosModeloEmail = {
  'usuario.senha_inicial': { nome: string; login: string; senhaTemporaria: string; urlAcesso: string };
  'usuario.senha_redefinida': { nome: string; login: string; senhaTemporaria: string; urlAcesso: string };
};
export type ModeloEmail = keyof DadosModeloEmail;

// Modelo sensível = os dados levam senha, token ou equivalente. Para esses, a US-025 apaga os
// dados do job depois do envio e também na falha definitiva (o outbox já apaga ao publicar).
export const SENSIBILIDADE_MODELO = {
  'usuario.senha_inicial': true,
  'usuario.senha_redefinida': true,
} as const satisfies Record<ModeloEmail, boolean>;

export const MODELOS_SENSIVEIS: ReadonlySet<ModeloEmail> = new Set(
  (Object.keys(SENSIBILIDADE_MODELO) as ModeloEmail[]).filter((m) => SENSIBILIDADE_MODELO[m]),
);

export type Destinatario = { email: string; nome?: string };

// E-mail num conjunto seguro de caracteres (sem espaço, quebra de linha, vírgula, ponto e vírgula,
// <, >, aspas nem NUL), com domínio de pelo menos dois rótulos, até 254 caracteres (RFC 5321).
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
// Nome de exibição sem caracteres de controle nem os que permitiriam montar outro endereço.
const NOME_PROIBIDO = /[<>,;"]/;

// Mascara o endereço para os detalhes do erro, que podem ir para log.
const mascarar = (email: string) => `${email.slice(0, 2)}***(${email.length})`;

export function validarDestinatario(destinatario: Destinatario): void {
  const { email, nome } = destinatario;
  const emailInvalido = email.length > 254 || !EMAIL.test(email);
  const nomeInvalido = nome !== undefined && (NOME_PROIBIDO.test(nome) || temCaractereDeControle(nome));
  if (emailInvalido || nomeInvalido) {
    throw new ErroDominio('email.destinatario_invalido', 'Destinatário de e-mail inválido.', { email: mascarar(email) });
  }
}
