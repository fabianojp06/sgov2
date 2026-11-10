import type { VersaoModelo } from './tipos';

// Versão publicada: imutável (o hash deste arquivo está em modelos-versoes.test.ts). Para mudar o
// texto, crie a v2 e aponte VERSAO_ATUAL para ela. Recuperação pela tela de login (US-029, frente A;
// EP084 UC01.01 A1): a senha atual continua valendo até a temporária ser usada. [PROVISÓRIO]
export const usuarioRecuperacaoSenhaV1: VersaoModelo<'usuario.recuperacao_senha'> = {
  assunto: () => '[SGO 2.0][Acesso] Nova senha solicitada',
  corpo: (d) => [
    { tipo: 'texto', texto: `Olá, ${d.nome}.` },
    { tipo: 'texto', texto: 'Recebemos um pedido de nova senha para o seu acesso ao SGO 2.0, feito pela tela de login.' },
    { tipo: 'campo', rotulo: 'Login', valor: d.login },
    { tipo: 'campo', rotulo: 'Senha temporária', valor: d.senhaTemporaria },
    { tipo: 'texto', texto: 'A senha temporária vale por 24 horas, pode ser usada uma única vez e precisa ser trocada no primeiro acesso.' },
    { tipo: 'texto', texto: 'Sua senha atual continua valendo até a senha temporária ser usada.' },
    { tipo: 'link', texto: 'Acessar o SGO 2.0', url: d.urlAcesso },
    { tipo: 'texto', texto: 'Se você não pediu uma nova senha, ignore este e-mail e avise o administrador do sistema.' },
  ],
};
