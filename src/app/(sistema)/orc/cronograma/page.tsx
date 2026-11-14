import { naoEncontradoSeNegado, obterCronograma, propostasParaCronograma, TelaCronograma } from '@/modules/orc';
import { exigirPagina } from '@/shared/authz';

// Cronograma de desembolso da proposta de TP (US-075, UC04.01): só consulta, para quem tem orc.cronograma. Com
// ?proposta=<id> (e ?meta=<id>), o cronograma da última versão; sem ela, a lista das propostas para escolher
// (plano do P25, Task 2). O custo do pessoal só entra para quem lança os empregados (D-P23-5).
type Busca = Partial<Record<'proposta' | 'meta', string | string[]>>;
const um = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function Cronograma({ searchParams }: { searchParams: Promise<Busca> }) {
  const ctx = await exigirPagina('orc.cronograma', 'consultar');
  const busca = await searchParams;
  const proposta = um(busca.proposta);
  const dados = proposta ? await obterCronograma(ctx, proposta, { meta: um(busca.meta) }).catch(naoEncontradoSeNegado(ctx)) : null;
  const propostas = dados ? [] : await propostasParaCronograma(ctx).catch(naoEncontradoSeNegado(ctx));
  return (
    <div>
      <h1>Cronograma de Desembolso</h1>
      {proposta && !dados && <p role="status">Proposta não encontrada nos seus Termos de Parceria.</p>}
      <TelaCronograma dados={dados} propostas={propostas} />
    </div>
  );
}
