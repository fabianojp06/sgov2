import { excluirRateioAcao, naoEncontradoSeNegado, obterRateio, propostasParaRateio, replicarRateioAcao, salvarRateioAcao, TelaRateio, textoAvisoRateio } from '@/modules/orc';
import { exigirPagina } from '@/shared/authz';

// Rateio/ISS da proposta de TP (US-073, UC03.03): ORCAMENTISTA e GFIN lançam; AUDITOR e DIREX consultam. Com
// ?proposta=<id>, a grade da última versão; sem ela, a lista das propostas do usuário (RLS) para escolher
// (plano do P24, Task 2).
type Busca = Partial<Record<'proposta' | 'aviso' | 'c', string | string[]>>;
const um = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function Rateio({ searchParams }: { searchParams: Promise<Busca> }) {
  const ctx = await exigirPagina('orc.rateio', 'consultar');
  const busca = await searchParams;
  const proposta = um(busca.proposta);
  const dados = proposta ? await obterRateio(ctx, proposta).catch(naoEncontradoSeNegado(ctx)) : null;
  const propostas = dados ? [] : await propostasParaRateio(ctx).catch(naoEncontradoSeNegado(ctx));
  const permissoes = {
    podeSalvar: ctx.permissoes.has('orc.rateio:incluir'),
    podeAlterar: ctx.permissoes.has('orc.rateio:alterar'),
    podeExcluir: ctx.permissoes.has('orc.rateio:excluir'),
  };
  return (
    <div>
      <h1>Rateio/ISS</h1>
      {proposta && !dados && <p role="status">Proposta não encontrada nos seus Termos de Parceria.</p>}
      <TelaRateio
        dados={dados}
        propostas={propostas}
        permissoes={permissoes}
        acoes={{ salvar: salvarRateioAcao, replicar: replicarRateioAcao, excluir: excluirRateioAcao }}
        aviso={dados ? textoAvisoRateio(um(busca.aviso), dados.numero, um(busca.c)) : undefined}
      />
    </div>
  );
}
