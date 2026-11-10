import type { VersaoModelo } from './tipos';

// Versão publicada: imutável (o hash deste arquivo está em modelos-versoes.test.ts). Para mudar o
// texto, crie a v2 e aponte VERSAO_ATUAL para ela. Textos [PROVISÓRIOS] (frente B, 10/11, a partir
// da proposta da frente A na #49).
const tentativas = (n: number) => (n === 1 ? '1 tentativa de acesso malsucedida' : `${n} tentativas de acesso malsucedidas`);

export const usuarioAlertaTentativasV1: VersaoModelo<'usuario.alerta_tentativas'> = {
  assunto: (d) => (d.bloqueado ? '[SGO 2.0][Acesso] Usuário bloqueado por tentativas de acesso' : '[SGO 2.0][Acesso] Tentativas de acesso malsucedidas'),
  corpo: (d) => [
    { tipo: 'texto', texto: `Olá, ${d.nomeAdministrador}.` },
    {
      tipo: 'texto',
      texto: d.bloqueado
        ? `O usuário ${d.nomeUsuario} foi bloqueado depois de ${tentativas(d.tentativas)}.`
        : `O usuário ${d.nomeUsuario} teve ${tentativas(d.tentativas)}.`,
    },
    { tipo: 'campo', rotulo: 'Login', valor: d.login },
    { tipo: 'campo', rotulo: 'Data e hora', valor: d.dataHora },
    {
      tipo: 'texto',
      texto: d.bloqueado
        ? 'Confirme com o usuário se as tentativas foram dele. Se for o caso, desbloqueie o acesso em Administração → Usuários. Se não foram, mantenha o bloqueio e consulte o Histórico de Operações.'
        : 'Se as tentativas não foram do usuário, verifique o acesso em Administração → Usuários.',
    },
    { tipo: 'link', texto: 'Abrir Administração → Usuários', url: d.urlAcesso },
  ],
};
