import { ErroDominio } from '@/shared/kernel';

// Contrato C4: modelos de e-mail e os dados de cada um. Novo modelo = nova chave;
// acrescentar chave não quebra os consumidores. O texto dos modelos não leva nome de
// instituição fixo: o nome vem de instituicao.nome_exibicao (spec §6.7).
export type DadosModeloEmail = {
  'usuario.senha_inicial': { nome: string; login: string; senhaTemporaria: string; urlAcesso: string };
  'usuario.senha_redefinida': { nome: string; login: string; senhaTemporaria: string; urlAcesso: string };
};
export type ModeloEmail = keyof DadosModeloEmail;

// Modelos com dado sensível (senha temporária): a US-025 apaga os dados do outbox e do job
// depois do envio, para a senha não ficar gravada em texto puro.
export const MODELOS_SENSIVEIS: ReadonlySet<ModeloEmail> = new Set<ModeloEmail>([
  'usuario.senha_inicial',
  'usuario.senha_redefinida',
]);

export type Destinatario = { email: string; nome?: string };

// Um endereço simples, sem espaço nem quebra de linha (que permitiria injetar cabeçalho),
// com uma arroba, parte local e domínio com ponto.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validarDestinatario(destinatario: Destinatario): void {
  if (!EMAIL.test(destinatario.email) || /[\r\n]/.test(destinatario.nome ?? '')) {
    throw new ErroDominio('email.destinatario_invalido', 'Destinatário de e-mail inválido.', {
      email: destinatario.email,
    });
  }
}
