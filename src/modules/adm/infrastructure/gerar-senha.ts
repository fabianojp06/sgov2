import { randomInt } from 'node:crypto';
import { SENHA_MAXIMO, validarSenha, type PoliticaSenha } from '../domain/politica-senha';

// Senha temporária gerada pelo sistema (UC02.18, RN0059): 16 caracteres de um alfabeto sem
// caracteres ambíguos (0/O, 1/l/I), sorteados com crypto.randomInt.
const ALFABETO = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TAMANHO = 16;

// Teto de sorteios: com letra e dígito no alfabeto, a chance de falhar 100 vezes seguidas é
// desprezível; passar disso é configuração impossível, e o erro é melhor que um laço infinito.
const SORTEIOS = 100;

export function gerarSenhaTemporaria(politica: PoliticaSenha): string {
  const tamanho = Math.min(Math.max(TAMANHO, politica.minimo), SENHA_MAXIMO);
  const efetiva = { ...politica, minimo: Math.min(politica.minimo, SENHA_MAXIMO) };
  for (let i = 0; i < SORTEIOS; i++) {
    const senha = Array.from({ length: tamanho }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');
    if (validarSenha(senha, efetiva).length === 0) return senha;
  }
  throw new Error('Não foi possível gerar uma senha temporária que atenda à política de senha');
}
