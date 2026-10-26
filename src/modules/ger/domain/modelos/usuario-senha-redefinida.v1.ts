import type { VersaoModelo } from './tipos';

// Versão publicada: imutável (o hash deste arquivo está em modelos-versoes.test.ts). Para mudar o
// texto, crie a v2 e aponte VERSAO_ATUAL para ela.
export const usuarioSenhaRedefinidaV1: VersaoModelo<'usuario.senha_redefinida'> = {
  assunto: () => '[SGO 2.0][Acesso] Sua senha foi redefinida',
  corpo: (d) => [
    { tipo: 'texto', texto: `Olá, ${d.nome}.` },
    { tipo: 'texto', texto: 'A senha do seu acesso ao SGO 2.0 foi redefinida pelo administrador.' },
    { tipo: 'campo', rotulo: 'Login', valor: d.login },
    { tipo: 'campo', rotulo: 'Senha temporária', valor: d.senhaTemporaria },
    { tipo: 'texto', texto: 'A senha temporária vale por 24 horas e precisa ser trocada no próximo acesso.' },
    { tipo: 'link', texto: 'Acessar o SGO 2.0', url: d.urlAcesso },
    { tipo: 'texto', texto: 'Se você não pediu a redefinição, avise o administrador do sistema.' },
  ],
};
