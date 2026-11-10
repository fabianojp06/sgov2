// Textos e regras puras da tela de perfis que o navegador usa (US-037): sem o kernel nem o Zod, para
// o formulário não levá-los ao bundle (como notificacao-textos.ts).

// Avisos da lista depois das ações: UC02.25 e UC02.26 com o texto do EP085; a exclusão [PROVISÓRIO].
export const AVISOS_PERFIL = {
  cadastrado: 'Perfil cadastrado com sucesso.',
  alterado: 'Perfil alterado com sucesso.',
  excluido: 'Perfil excluído com sucesso.',
} as const;

// E3 do UC02.26 (EP085), texto fixado.
export const MENSAGEM_CONFIRMAR_INATIVACAO =
  'Este perfil possui usuários ativos associados. Ao inativá-lo, esses usuários perderão o acesso às funcionalidades deste perfil. Deseja continuar?';

// [PROVISÓRIO] Inativar perfil sem usuários ativos na abertura da tela (revisão 12.12 do #369): a tela
// confirma também, porque alguém pode ter associado um usuário depois; o servidor confere de novo.
export const MENSAGEM_CONFIRMAR_INATIVACAO_SEM_USUARIOS =
  'Ao inativar o perfil, os usuários associados a ele perdem o acesso às funcionalidades dele. Deseja continuar?';
export const NOTA_ADMINISTRADOR_ATIVO = 'O perfil Administrador não pode ser inativado.';

// [PROVISÓRIO] (ajuste A3 da revisão do plano): o escopo por CC (C25) depende do código GESTOR_DIRETORIA.
export const AVISO_SEM_ESCOPO =
  'Usuários deste perfil não têm CC de escopo: lançam em toda a Administração Central. Para limitar a uma diretoria, use o perfil Gestor de Diretoria.';

// Funcionalidades em que o perfil sem CC de escopo lança em toda a Adm. Central (C25, ajuste A3).
const COM_ESCOPO_CC: readonly string[] = ['orc.pacotes', 'orc.posicoes'];
const ACOES_DE_LANCAMENTO: readonly string[] = ['incluir', 'alterar', 'excluir'];

// O aviso vale para o perfil não padrão: no Gestor de Diretoria, o escopo vem do cadastro do usuário.
export function precisaAvisoSemEscopo(padrao: boolean, permissoes: readonly { funcionalidade: string; acoes: readonly string[] }[]): boolean {
  return !padrao && permissoes.some((p) => COM_ESCOPO_CC.includes(p.funcionalidade) && p.acoes.some((a) => ACOES_DE_LANCAMENTO.includes(a)));
}
