// Chave fixa dos testes da cifra dos salários (R7): 32 bytes conhecidos. Recusada com AMBIENTE=producao.
// Não é segredo: existe para os testes e o dev não dependerem de uma chave gerada.
export const CHAVE_TESTE_CIFRA = Buffer.from('sgo-chave-de-teste-cifra-32bytes', 'utf8').toString('base64');
export const ID_CHAVE_TESTE = 'teste1';
