import { AnaliseQuadroIA, analiseQuadroLiberada, analisarQuadroPessoalAcao, lerFiltrosQuadro, MENSAGENS_QUADRO, obterQuadroPessoal, TabelaQuadro } from '@/modules/rel';
import { exigirPagina } from '@/shared/authz';

// Análise do quadro de pessoal (US-107, IA-07): os agregados do pessoal lançado nas propostas, com os
// filtros na URL (?tipo=TERMO_PARCERIA&proposta=texto) e, com a IA ligada para o perfil, a análise.
export default async function QuadroPessoal({ searchParams }: { searchParams: Promise<{ tipo?: string; proposta?: string }> }) {
  const ctx = await exigirPagina('rel.ia_quadro_pessoal', 'consultar');
  const { tipo = '', proposta = '' } = await searchParams;
  const lidos = lerFiltrosQuadro({ tipo, proposta });
  const filtros = lidos ?? {};
  // Filtro inválido: não lê nada (a leitura é a parte cara).
  const [lido, iaLiberada] = await Promise.all([lidos ? obterQuadroPessoal(ctx, lidos) : null, analiseQuadroLiberada(ctx)]);
  const comPessoal = lido !== null && lido.ok && lido.valor.propostas.length > 0;
  return (
    <div>
      <h1>Análise do quadro de pessoal</h1>
      <p>
        Agregados do pessoal lançado na última versão de cada proposta que você acessa: postos por categoria, vagas &quot;A CONTRATAR&quot;,
        evolução por ano (no mês de referência, dezembro ou o fim da vigência, e em algum mês do ano) e postos por cargo. O custo só aparece
        como total da proposta, com pelo menos 3 postos calculados e custos diferentes entre si; nunca por cargo nem por pessoa.
      </p>
      <form method="get" action="/rel/quadro-pessoal">
        <p>
          <label htmlFor="quadro-tipo">Tipo</label>{' '}
          <select id="quadro-tipo" name="tipo" defaultValue={filtros.tipo ?? ''}>
            <option value="">Todos</option>
            <option value="TERMO_PARCERIA">Termo de Parceria</option>
            <option value="CONTRATO">Contrato</option>
          </select>{' '}
          <label htmlFor="quadro-proposta">Proposta</label>{' '}
          <input id="quadro-proposta" name="proposta" maxLength={100} defaultValue={filtros.proposta ?? ''} /> <button type="submit">Filtrar</button>
        </p>
      </form>
      {lido === null ? (
        <p role="alert">{MENSAGENS_QUADRO.FILTROS_INVALIDOS}</p>
      ) : !lido.ok ? (
        <p role="alert">{lido.erros.map((e) => e.mensagem).join(' ')}</p>
      ) : !comPessoal ? (
        <p>{MENSAGENS_QUADRO.SEM_PESSOAL}</p>
      ) : (
        <>
          {iaLiberada && ctx.permissoes.has('rel.ia_quadro_pessoal:executar') && (
            <AnaliseQuadroIA filtros={{ tipo: filtros.tipo ?? '', proposta: filtros.proposta ?? '' }} analisar={analisarQuadroPessoalAcao} />
          )}
          <h2>Agregados</h2>
          <TabelaQuadro quadro={lido.valor} />
        </>
      )}
    </div>
  );
}
