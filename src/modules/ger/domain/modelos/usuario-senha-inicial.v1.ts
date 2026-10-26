import type { VersaoModelo } from './tipos';

// Versão publicada: imutável (o hash deste arquivo está em modelos-versoes.test.ts). Para mudar o
// texto, crie a v2 e aponte VERSAO_ATUAL para ela.
export const usuarioSenhaInicialV1: VersaoModelo<'usuario.senha_inicial'> = {
  assunto: () => '[SGO 2.0][Acesso] Seu acesso ao sistema',
  corpo: (d) => [
    { tipo: 'texto', texto: `Olá, ${d.nome}.` },
    { tipo: 'texto', texto: 'Seu acesso ao SGO 2.0 foi criado.' },
    { tipo: 'campo', rotulo: 'Login', valor: d.login },
    { tipo: 'campo', rotulo: 'Senha temporária', valor: d.senhaTemporaria },
    { tipo: 'texto', texto: 'A senha temporária vale por 24 horas e precisa ser trocada no primeiro acesso.' },
    { tipo: 'link', texto: 'Acessar o SGO 2.0', url: d.urlAcesso },
    { tipo: 'texto', texto: 'Se você não esperava este e-mail, avise o administrador do sistema.' },
  ],
};
