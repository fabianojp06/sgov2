import {
  AnaliseQuadroIA,
  analiseQuadroLiberada,
  analisarQuadroPessoalAcao,
  lerFiltrosQuadro,
  MENSAGENS_QUADRO,
  obterQuadroAdmCentral,
  obterQuadroPessoal,
  TabelaAdmCentral,
  TabelaQuadro,
} from '@/modules/rel';
import { exigirPagina } from '@/shared/authz';

// Análise do quadro de pessoal (US-107, IA-07): os agregados do pessoal lançado nas propostas e, para quem
// consulta as posições, as da Administração Central por diretoria (parte 2), com os filtros na URL
// (?tipo=TERMO_PARCERIA&proposta=texto&ano=2027) e, com a IA ligada para o perfil, a análise.
export default async function QuadroPessoal({ searchParams }: { searchParams: Promise<{ tipo?: string; proposta?: string; ano?: string }> }) {
  const ctx = await exigirPagina('rel.ia_quadro_pessoal', 'consultar');
  const { tipo = '', proposta = '', ano = '' } = await searchParams;
  const lidos = lerFiltrosQuadro({ tipo, proposta, ano });
  // Filtro inválido: não lê nada (a leitura é a parte cara).
  const [lido, adm, iaLiberada] = await Promise.all([
    lidos ? obterQuadroPessoal(ctx, lidos) : null,
    lidos ? obterQuadroAdmCentral(ctx, lidos.ano ? Number(lidos.ano) : null) : null,
    analiseQuadroLiberada(ctx),
  ]);
  const filtros = lidos ?? {};
  const comPessoal = lido !== null && lido.ok && lido.valor.propostas.length > 0;
  const comAdm = adm !== null && adm.quadro.exercicios.some((e) => e.postos > 0);
  return (
    <div>
      <h1>Análise do quadro de pessoal</h1>
      <p>
        Agregados do pessoal lançado na última versão de cada proposta que você acessa: postos por categoria, vagas &quot;A CONTRATAR&quot;,
        evolução por ano (no mês de referência, dezembro ou o fim da vigência, e em algum mês do ano) e postos por cargo. Para quem consulta
        as posições orçadas, também a Administração Central por diretoria, no exercício escolhido e no anterior. O custo só aparece como total
        (da proposta ou da diretoria), com pelo menos 3 postos calculados e custos diferentes entre si; nunca por cargo nem por pessoa.
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
          <input id="quadro-proposta" name="proposta" maxLength={100} defaultValue={filtros.proposta ?? ''} />{' '}
          {adm && (
            <>
              <label htmlFor="quadro-ano">Exercício da Adm. Central</label>{' '}
              <select id="quadro-ano" name="ano" defaultValue={String(adm.ano)}>
                {adm.anos.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>{' '}
            </>
          )}
          <button type="submit">Filtrar</button>
        </p>
      </form>
      {lido === null ? (
        <p role="alert">{MENSAGENS_QUADRO.FILTROS_INVALIDOS}</p>
      ) : (
        <>
          {iaLiberada && ctx.permissoes.has('rel.ia_quadro_pessoal:executar') && (comPessoal || comAdm) && (
            <AnaliseQuadroIA
              filtros={{ tipo: filtros.tipo ?? '', proposta: filtros.proposta ?? '', ano: adm ? String(adm.ano) : '' }}
              analisar={analisarQuadroPessoalAcao}
            />
          )}
          <h2>Propostas e termos de parceria</h2>
          {!lido.ok ? <p role="alert">{lido.erros.map((e) => e.mensagem).join(' ')}</p> : comPessoal ? <TabelaQuadro quadro={lido.valor} /> : <p>{MENSAGENS_QUADRO.SEM_PESSOAL}</p>}
          {adm && (
            <>
              <h2>Administração Central</h2>
              {comAdm ? <TabelaAdmCentral quadro={adm.quadro} /> : <p>Nenhuma posição orçada no exercício {adm.ano}.</p>}
            </>
          )}
        </>
      )}
    </div>
  );
}
