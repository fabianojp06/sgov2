import { naoEncontradoSeNegado, obterTotalizadores, propostasParaTotalizar, TelaTotalizadores } from '@/modules/orc';
import { exigirPagina } from '@/shared/authz';

// Totalizadores da proposta de TP (US-074, UC03.02): só consulta, para quem tem orc.totalizadores. Com
// ?proposta=<id>, a árvore de totais da última versão; sem ela, a lista das propostas do usuário (RLS) para
// escolher (plano do P23, D-P23-4). O custo do pessoal só entra para quem lança os empregados (D-P23-5).
type Busca = Partial<Record<'proposta', string | string[]>>;
const um = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function Totalizadores({ searchParams }: { searchParams: Promise<Busca> }) {
  const ctx = await exigirPagina('orc.totalizadores', 'consultar');
  const proposta = um((await searchParams).proposta);
  const dados = proposta ? await obterTotalizadores(ctx, proposta).catch(naoEncontradoSeNegado(ctx)) : null;
  const propostas = dados ? [] : await propostasParaTotalizar(ctx).catch(naoEncontradoSeNegado(ctx));
  return (
    <div>
      <h1>Totalizadores</h1>
      {proposta && !dados && <p role="status">Proposta não encontrada nos seus Termos de Parceria.</p>}
      <TelaTotalizadores dados={dados} propostas={propostas} />
    </div>
  );
}
