import { ComentariosComparativoIA, comentarComparativoAcao, comentariosComparativoLiberados, MENSAGENS_COMPARATIVO, obterComparativo, TabelaComparativo } from '@/modules/rel';
import { exigirPagina } from '@/shared/authz';

// Comparativo entre TPs (US-106, IA-17), no menu da Administração Central: os indicadores por TP, com os
// pontos fora da curva marcados pelo sistema e, com a IA ligada para o perfil, os comentários. Cada abertura
// grava a CONSULTA no Histórico (o consolidado do orc, spec §6.7).
export default async function ComparativoTps() {
  const ctx = await exigirPagina('rel.comparativo_tps', 'consultar');
  const [lido, iaLiberada] = await Promise.all([obterComparativo(ctx), comentariosComparativoLiberados(ctx)]);
  return (
    <div>
      <h1>Comparativo entre TPs</h1>
      <p>
        Os Termos de Parceria lado a lado, pela última versão oficializada de cada um (ou pela última versão, marcada como não oficial).
        Só leitura; cada abertura fica registrada no Histórico de Operações.
      </p>
      {!lido.ok ? (
        <p>{lido.erros.map((e) => e.mensagem).join(' ')}</p>
      ) : lido.valor.tps.length === 0 ? (
        <p>{MENSAGENS_COMPARATIVO.SEM_TPS}</p>
      ) : (
        <>
          {iaLiberada && ctx.permissoes.has('rel.comparativo_tps:executar') && <ComentariosComparativoIA comentar={comentarComparativoAcao} />}
          <TabelaComparativo comparativo={lido.valor} />
        </>
      )}
    </div>
  );
}
