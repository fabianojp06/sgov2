import { MENSAGENS } from '../domain/mensagens';

// Regras da tela de login que rodam no cliente (UC01.01). O estado fica só na memória do
// componente (RNF0002).
export type CamposLogin = { login: string; senha: string };

export const MENSAGEM_REDE = 'Não foi possível estabelecer conexão com o servidor. Verifique sua rede e tente novamente.';

// E1 (RN0012/RN0013/RN0016): vazio ou só espaços não envia a requisição.
export function validarCampos(login: string, senha: string): string | null {
  return login.trim() === '' || senha.trim() === '' ? MENSAGENS.OBRIGATORIOS : null;
}

// A3: Cancelar limpa os campos, sem requisição.
export const aoCancelar = (): CamposLogin => ({ login: '', senha: '' });

// E2: credenciais recusadas limpam só a senha.
export const aoFalhar = (c: CamposLogin): CamposLogin => ({ login: c.login, senha: '' });
