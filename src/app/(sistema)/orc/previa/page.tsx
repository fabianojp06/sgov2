import { notFound } from 'next/navigation';
import { naoEncontradoSeNegado, obterPreVisualizacao, TelaPreVisualizacao } from '@/modules/orc';
import { exigirPagina } from '@/shared/authz';

// Pré-visualização da proposta de TP (US-068; UC03.38; plano do P29): só leitura, para quem consulta as propostas,
// desde o Rascunho (D-P29-1). ?proposta=<id>; fora dos TPs do usuário (RLS) ou id inválido, 404.
type Busca = Partial<Record<'proposta', string | string[]>>;
const um = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
const formato = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

export default async function PreVisualizacao({ searchParams }: { searchParams: Promise<Busca> }) {
  const ctx = await exigirPagina('orc.propostas', 'consultar');
  const proposta = um((await searchParams).proposta);
  const dados = proposta ? await obterPreVisualizacao(ctx, proposta).catch(naoEncontradoSeNegado(ctx)) : null;
  if (!dados) notFound();
  return (
    <div>
      <h1>Pré-visualização da proposta</h1>
      <TelaPreVisualizacao dados={dados} emitidoEm={formato.format(new Date())} />
    </div>
  );
}
