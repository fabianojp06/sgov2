import { notFound } from 'next/navigation';
import { excluirAlcada, FormAlcada, listarAprovadoresPossiveis, obterAlcada, trocarAprovadores } from '@/modules/adm';
import { exigirPagina } from '@/shared/authz';

// Alterar Alçada de Aprovação (US-042): troca os aprovadores ou exclui (soft delete). Só a ativa.
export default async function AlterarAlcada({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await exigirPagina('adm.alcadas', 'alterar');
  const { id } = await params;
  const [alcada, usuarios] = await Promise.all([obterAlcada(ctx, id), listarAprovadoresPossiveis(ctx)]);
  if (!alcada || !alcada.ativa) notFound();
  // Aprovador atual que ficou inativo continua como opção, identificado: sem isso, o select marcaria
  // sozinho outro usuário e a troca de um aprovador mudaria o outro em silêncio. Salvar com ele
  // inativo é recusado no servidor (§11.4: titular e substituto ativos).
  const opcoes = [
    ...[alcada.titular, alcada.substituto].filter((a) => !a.ativo && !usuarios.some((u) => u.id === a.id)).map((a) => ({ id: a.id, nome: `${a.nome} (inativo)` })),
    ...usuarios,
  ];
  return (
    <div>
      <h1>Alterar Alçada de Aprovação</h1>
      <FormAlcada
        alcada={{ id: alcada.id, fluxo: alcada.fluxo, rotuloFluxo: alcada.rotuloFluxo, titularId: alcada.titular.id, substitutoId: alcada.substituto.id, versao: alcada.versao }}
        fluxos={[]}
        usuarios={opcoes}
        salvar={trocarAprovadores}
        {...(ctx.permissoes.has('adm.alcadas:excluir') ? { excluir: excluirAlcada } : {})}
      />
    </div>
  );
}
