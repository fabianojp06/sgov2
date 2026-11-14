import { carregarRealizadoAcao, fecharCompetenciaAcao, reprocessarPendenciasAcao, naoEncontradoSeNegado, obterTelaRealizado, propostasParaRealizado, TelaRealizado } from '@/modules/orc';
import { exigirPagina } from '@/shared/authz';

// Realizado do TP (US-085, parte 1; plano do P32, Task 3): com ?proposta=<id>, o realizado do TP e a carga do arquivo
// (orc.realizado:executar); sem ela, a lista para escolher. O fechamento da competência pede orc.realizado:aprovar.
type Busca = Partial<Record<'proposta', string | string[]>>;
const um = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function Realizado({ searchParams }: { searchParams: Promise<Busca> }) {
  const ctx = await exigirPagina('orc.realizado', 'consultar');
  const proposta = um((await searchParams).proposta);
  const dados = proposta ? await obterTelaRealizado(ctx, proposta).catch(naoEncontradoSeNegado(ctx)) : null;
  const propostas = dados ? [] : await propostasParaRealizado(ctx).catch(naoEncontradoSeNegado(ctx));
  return (
    <div>
      <h1>Realizado</h1>
      {proposta && !dados && <p role="status">Termo de Parceria não encontrado nos seus Termos de Parceria.</p>}
      <TelaRealizado
        dados={dados}
        propostas={propostas}
        carregar={ctx.permissoes.has('orc.realizado:executar') ? carregarRealizadoAcao : null}
        fechar={ctx.permissoes.has('orc.realizado:aprovar') ? fecharCompetenciaAcao : null}
        reprocessar={ctx.permissoes.has('orc.realizado:executar') ? reprocessarPendenciasAcao : null}
      />
    </div>
  );
}
