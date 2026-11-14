import { notFound } from 'next/navigation';
import { AcaoConfirmada } from '@/modules/ger';
import { alterarTextosAcao, aprovarRelatorioAcao, dataEmBrasilia, EditarTextos, obterRelatorio } from '@/modules/rel';
import { exigirPagina } from '@/shared/authz';
import { Dinheiro } from '@/shared/kernel';

// Detalhe do relatório executivo (US-103): os indicadores congelados na geração, os textos e, no rascunho,
// a revisão e a aprovação pela GFIN. O PDF do rascunho sai marcado "não distribuir".
const moeda = (v: string | null) => (v === null ? '—' : Dinheiro.de(v).formatar());
const pct = (v: string | null) => (v === null ? '—' : `${v.replace('.', ',')}%`);

export default async function DetalheRelatorio({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ aviso?: string }> }) {
  const ctx = await exigirPagina('rel.relatorio_executivo', 'consultar');
  const [{ id }, { aviso }] = await Promise.all([params, searchParams]);
  const r = await obterRelatorio(ctx, id);
  if (!r) notFound();
  const rascunho = r.situacao === 'RASCUNHO';
  const a = r.dados.admCentral;
  const podeEditar = rascunho && ctx.permissoes.has('rel.relatorio_executivo:alterar');
  return (
    <div>
      <h1>Relatório executivo de {`${r.mes.slice(5, 7)}/${r.mes.slice(0, 4)}`}</h1>
      {aviso === 'aprovado' && <p role="status">Relatório aprovado.</p>}
      <p>
        <strong>{rascunho ? 'Rascunho – não distribuir. Gerado com IA – revisar.' : `Aprovado por ${r.aprovadoRotulo ?? ''}.`}</strong>
      </p>
      {ctx.permissoes.has('rel.relatorio_executivo:exportar') && (
        <p>
          <a href={`/rel/relatorio-executivo/${r.id}/pdf`}>Baixar o PDF{rascunho ? ' (rascunho)' : ''}</a>
        </p>
      )}
      {/* Quem aprova sem editar: o botão fica aqui; com a edição, ele vai no formulário (some com alteração não salva). */}
      {rascunho && ctx.permissoes.has('rel.relatorio_executivo:aprovar') && !podeEditar && (
        <AcaoConfirmada
          rotulo="Aprovar"
          contexto={`o relatório de ${r.mes}`}
          pergunta="Deseja realmente aprovar este relatório? Depois de aprovado, ele não pode mais ser alterado."
          acao={aprovarRelatorioAcao}
          campos={{ id: r.id, versao: String(r.versao) }}
        />
      )}
      <h2>Indicadores</h2>
      <p>Posição de {dataEmBrasilia(r.geradoEm)}, quando o rascunho foi gerado.</p>
      {a ? (
        <dl>
          <dt>Administração Central, exercício {a.ano}</dt>
          <dd>{a.situacao}</dd>
          <dt>Orçamento do ano</dt>
          <dd>{moeda(a.orcamentoAno)}</dd>
          <dt>Pessoal</dt>
          <dd>
            {moeda(a.pessoal)} ({pct(a.percentualPessoal)}), {a.empregadosDezembro} empregados em dezembro
          </dd>
          <dt>Teto e uso</dt>
          <dd>
            {moeda(a.tetoEfetivo)} ({pct(a.usoDoTeto)})
          </dd>
          <dt>Resultado do ano e saldo</dt>
          <dd>
            {moeda(a.resultadoAno)} · {moeda(a.saldo)}
          </dd>
        </dl>
      ) : (
        <p>Sem indicadores da Administração Central.</p>
      )}
      {r.dados.tps && r.dados.tps.length > 0 ? (
        <table>
          <caption>Termos de Parceria</caption>
          <thead>
            <tr>
              <th scope="col">TP</th>
              <th scope="col">Valor Global</th>
              <th scope="col">Execução</th>
            </tr>
          </thead>
          <tbody>
            {r.dados.tps.map((t) => (
              <tr key={t.numero}>
                <th scope="row">
                  {t.numero} {t.oficial ? '' : '(versão não oficial)'}
                </th>
                <td>{moeda(t.valorGlobal)}</td>
                <td>{pct(t.execucao)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>Sem indicadores dos Termos de Parceria.</p>
      )}
      {podeEditar ? (
        <EditarTextos
          id={r.id}
          mes={r.mes}
          versao={r.versao}
          textos={r.textos}
          salvar={alterarTextosAcao}
          aprovar={ctx.permissoes.has('rel.relatorio_executivo:aprovar') ? aprovarRelatorioAcao : undefined}
        />
      ) : (
        <>
          <h2>Resumo</h2>
          <p>{r.textos.resumo}</p>
          <h2>Riscos</h2>
          <ul>
            {r.textos.riscos.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
          <h2>Recomendações</h2>
          <ul>
            {r.textos.recomendacoes.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
