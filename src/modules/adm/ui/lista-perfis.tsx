import { AcaoConfirmada, type AcaoFormulario } from '@/modules/ger';
import { AVISOS_PERFIL } from '../domain/perfil-textos';

// Perfis de Usuário (US-037; UC02.07, REQ0069): Nome, Descrição, Status e, a mais, a quantidade de
// usuários [PROVISÓRIO], que explica por que o Excluir não aparece (RN0072). Para quem pode alterar,
// o nome leva ao formulário (o "clicar duas vezes" do EP vira link, que também funciona pelo
// teclado). Excluir, com confirmação, só no perfil criado pela tela e sem usuários (D-P13-3, D-P13-12).
// Tabela comum, e não a grade do C3, por causa da coluna de ações.
type ItemLista = { id: string; nome: string; descricao: string; ativo: boolean; padrao: boolean; usuarios: number; versao: number };

// A URL leva só o código do aviso: texto livre na query seria um vetor de conteúdo forjado.
const AVISOS: Readonly<Record<string, string>> = AVISOS_PERFIL;

export const podeExcluirPerfil = (p: { padrao: boolean; usuarios: number }) => !p.padrao && p.usuarios === 0;

export function ListaPerfis({
  perfis,
  podeIncluir,
  podeAlterar,
  podeExcluir,
  excluir,
  aviso,
}: {
  perfis: readonly ItemLista[];
  podeIncluir: boolean;
  podeAlterar: boolean;
  podeExcluir: boolean;
  excluir: AcaoFormulario;
  aviso?: string | undefined;
}) {
  const textoAviso = aviso !== undefined && Object.hasOwn(AVISOS, aviso) ? AVISOS[aviso] : undefined;
  const comAcoes = podeExcluir && perfis.some(podeExcluirPerfil);
  return (
    <div>
      <h1>Perfis de Usuário</h1>
      {textoAviso && <p role="status">{textoAviso}</p>}
      {podeIncluir && <a href="/adm/perfis/novo">Novo</a>}
      {perfis.length === 0 ? (
        // Texto vazio [PROVISÓRIO].
        <p>Nenhum perfil cadastrado.</p>
      ) : (
        <table>
          <caption>Perfis de Usuário</caption>
          <thead>
            <tr>
              <th scope="col">Nome</th>
              <th scope="col">Descrição</th>
              <th scope="col">Status</th>
              <th scope="col">Usuários</th>
              {comAcoes && <th scope="col">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {perfis.map((p) => (
              <tr key={p.id}>
                <th scope="row">{podeAlterar ? <a href={`/adm/perfis/${p.id}`}>{p.nome}</a> : p.nome}</th>
                <td>{p.descricao}</td>
                <td>{p.ativo ? 'Ativo' : 'Inativo'}</td>
                <td>{p.usuarios}</td>
                {comAcoes && (
                  <td>
                    {podeExcluirPerfil(p) && (
                      <AcaoConfirmada
                        rotulo={`Excluir ${p.nome}`}
                        // Pergunta [PROVISÓRIA]: o EP085 não dá o texto.
                        pergunta={`Deseja realmente excluir o perfil ${p.nome}?`}
                        acao={excluir}
                        campos={{ id: p.id, versao: String(p.versao) }}
                      />
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
