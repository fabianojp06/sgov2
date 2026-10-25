import { randomInt } from 'node:crypto';
import { validarSenha, type PoliticaSenha } from '../domain/politica-senha';

// Senha temporária gerada pelo sistema (UC02.18, RN0059): 16 caracteres de um alfabeto sem
// caracteres ambíguos (0/O, 1/l/I), sorteados com crypto.randomInt.
const ALFABETO = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TAMANHO = 16;

export function gerarSenhaTemporaria(politica: PoliticaSenha): string {
  const tamanho = Math.max(TAMANHO, politica.minimo);
  for (;;) {
    const senha = Array.from({ length: tamanho }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');
    if (validarSenha(senha, politica).length === 0) return senha;
  }
}
