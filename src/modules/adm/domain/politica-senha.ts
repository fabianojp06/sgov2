import type { ErroCampo } from '@/shared/kernel';

// Critérios de segurança da senha (RN0039). Valores [PROVISÓRIOS] (GAP-AUT-002, spec §11.2a),
// lidos da ConfiguracaoAcesso.
export type PoliticaSenha = { minimo: number; exigeLetra: boolean; exigeDigito: boolean };

export const POLITICA_PADRAO: PoliticaSenha = { minimo: 10, exigeLetra: true, exigeDigito: true };

// Teto da entrada: senha maior que isso só serviria para gastar CPU no Argon2.
export const SENHA_MAXIMO = 128;

export function validarSenha(senha: string, politica: PoliticaSenha, campo = 'novaSenha'): readonly ErroCampo[] {
  const erros: ErroCampo[] = [];
  if ([...senha].length < politica.minimo) {
    erros.push({ campo, mensagem: `A senha deve ter pelo menos ${politica.minimo} caracteres` });
  }
  if ([...senha].length > SENHA_MAXIMO) {
    erros.push({ campo, mensagem: `A senha deve ter no máximo ${SENHA_MAXIMO} caracteres` });
  }
  if (politica.exigeLetra && !/\p{L}/u.test(senha)) erros.push({ campo, mensagem: 'A senha deve ter pelo menos uma letra' });
  if (politica.exigeDigito && !/\p{Nd}/u.test(senha)) erros.push({ campo, mensagem: 'A senha deve ter pelo menos um dígito' });
  return erros;
}
