import { destacarRiscosAcao, iaLiberada, naoEncontradoSeNegado, obterPrevisaoFechamento, TelaPrevisao } from '@/modules/orc';
import { exigirPagina } from '@/shared/authz';

// Previsão de fechamento do ano do TP (US-091; IA-10): só leitura, com a permissão do Orçado x Realizado. Filtros na URL
// (?proposta, ?ano). O destaque da IA aparece só com o caso ligado e a permissão dele (iaLiberada).
type Busca = Partial<Record<'proposta' | 'ano', string | string[]>>;
const um = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function PrevisaoFechamento({ searchParams }: { searchParams: Promise<Busca> }) {
  const ctx = await exigirPagina('orc.oxr', 'consultar');
  const b = await searchParams;
  const [dados, comIa] = await Promise.all([
    obterPrevisaoFechamento(ctx, { proposta: um(b.proposta), ano: um(b.ano) }).catch(naoEncontradoSeNegado(ctx)),
    iaLiberada(ctx, 'previsao'),
  ]);
  return (
    <div>
      <h1>Previsão de fechamento do ano</h1>
      <p>
        <a href="/orc/orcado-realizado">Voltar ao Orçado x Realizado</a>
      </p>
      <TelaPrevisao dados={dados} ia={comIa ? destacarRiscosAcao : null} />
    </div>
  );
}
