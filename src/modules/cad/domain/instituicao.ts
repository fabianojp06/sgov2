import { falha, ok, type Resultado } from '@/shared/kernel';

// Nome de exibição da instituição (spec §6.7, #434): o nome que as telas e os e-mails mostram, nunca
// fixo no código. O limite e os caracteres recusados são os do cabeçalho do e-mail
// (ger/domain/renderizar-email.ts e ger/domain/texto.ts): um nome aceito aqui nunca reprova o e-mail.
// Vazio é permitido e volta ao padrão "SGO".

export const TAMANHO_NOME_EXIBICAO = 120;

function temCaractereDeControle(texto: string): boolean {
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029) return true;
  }
  return false;
}

/** O nome sem os espaços das pontas, ou o erro do campo `nome`. */
export function validarNomeExibicao(texto: string): Resultado<string> {
  const nome = texto.trim();
  if (nome.length > TAMANHO_NOME_EXIBICAO) return falha([{ campo: 'nome', mensagem: `Use no máximo ${TAMANHO_NOME_EXIBICAO} caracteres.` }]);
  if (temCaractereDeControle(nome)) return falha([{ campo: 'nome', mensagem: 'O nome não pode ter quebra de linha nem caractere de controle.' }]);
  return ok(nome);
}
