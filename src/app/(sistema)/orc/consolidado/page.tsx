import { naoEncontradoSeNegado, obterConsolidado, TelaConsolidado } from '@/modules/orc';
import { exigirPagina } from '@/shared/authz';

// Consolidado dos TPs (US-101; spec §6.7; plano do P31): só para quem tem orc.consolidado; cada abertura vai ao
// Histórico (acesso auditado). Todos os TPs ativos, mesmo os que a pessoa não opera.
export default async function ConsolidadoDosTps() {
  const ctx = await exigirPagina('orc.consolidado', 'consultar');
  const dados = await obterConsolidado(ctx).catch(naoEncontradoSeNegado(ctx));
  return (
    <div>
      <h1>Consolidado dos TPs</h1>
      <TelaConsolidado dados={dados} />
    </div>
  );
}
