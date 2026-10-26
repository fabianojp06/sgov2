import { GradeArvore, type ColunaGrade, type NoGrade } from '@/modules/ger';

// UC02.11: listagem de usuários com Nome e Status (REQ0078). Para quem pode alterar, a primeira
// célula leva à alteração (UC02.13: o "clicar duas vezes" do EP vira link, que também funciona
// pelo teclado); quem só consulta não recebe link que daria 404.
type ItemLista = { id: string; nome: string; ativo: boolean; bloqueado: boolean };

// Mensagens de confirmação depois do redirecionamento das ações (UC02.12, UC02.13, A3). A URL leva
// só o código: texto livre na query seria um vetor de conteúdo forjado na tela.
const AVISOS: Readonly<Record<string, string>> = {
  cadastrado: 'Usuário cadastrado com sucesso. A senha foi enviada para o e-mail informado.',
  alterado: 'Alteração no cadastro do usuário realizada com sucesso',
  desbloqueado: 'Usuário desbloqueado com sucesso',
};

export function statusUsuario(u: { ativo: boolean; bloqueado: boolean }): string {
  const status = u.ativo ? 'Ativo' : 'Inativo';
  return u.bloqueado ? `${status} (bloqueado)` : status;
}

const COLUNAS: readonly ColunaGrade<'nome' | 'status'>[] = [
  { campo: 'nome', titulo: 'Nome', tipo: 'texto' },
  { campo: 'status', titulo: 'Status', tipo: 'texto', largura: 200 },
];

export function ListaUsuarios({
  usuarios,
  podeIncluir,
  podeAlterar,
  aviso,
}: {
  usuarios: readonly ItemLista[];
  podeIncluir: boolean;
  podeAlterar: boolean;
  aviso?: string | undefined;
}) {
  const textoAviso = aviso !== undefined && Object.hasOwn(AVISOS, aviso) ? AVISOS[aviso] : undefined;
  const nos: NoGrade<'nome' | 'status'>[] = usuarios.map((u) => ({
    id: u.id,
    linha: { nome: u.nome, status: statusUsuario(u) },
    ...(podeAlterar ? { href: `/adm/usuarios/${u.id}` } : {}),
  }));
  return (
    <main>
      <h1>Usuários</h1>
      {textoAviso && <p role="status">{textoAviso}</p>}
      {podeIncluir && <a href="/adm/usuarios/novo">Novo</a>}
      <GradeArvore idGrade="adm.usuarios" rotulo="Usuários" nos={nos} colunas={COLUNAS} textoVazio="Nenhum usuário cadastrado." />
    </main>
  );
}
