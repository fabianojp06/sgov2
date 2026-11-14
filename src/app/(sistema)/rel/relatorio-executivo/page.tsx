import { dataEmBrasilia, GerarRascunho, gerarRascunhoAcao, geracaoRelatorioLiberada, listarRelatorios, mesEmBrasilia } from '@/modules/rel';
import { exigirPagina } from '@/shared/authz';

// Relatório executivo mensal (US-103, IA-14): a lista dos meses e, para a GFIN com a IA ligada, o
// formulário de gerar o rascunho. Quem só consulta vê só os aprovados.

export default async function RelatorioExecutivo() {
  const ctx = await exigirPagina('rel.relatorio_executivo', 'consultar');
  const [relatorios, iaLiberada] = await Promise.all([listarRelatorios(ctx), geracaoRelatorioLiberada(ctx)]);
  return (
    <div>
      <h1>Relatório executivo mensal</h1>
      <p>
        O relatório do mês para diretores e gerentes: indicadores da Administração Central e dos Termos de Parceria, gráficos do sistema e
        textos redigidos com IA, revisados e aprovados pela Gerência Financeira antes de distribuir.
      </p>
      {iaLiberada && ctx.permissoes.has('rel.relatorio_executivo:executar') && <GerarRascunho mesAtual={mesEmBrasilia(new Date())} gerar={gerarRascunhoAcao} />}
      <h2>Relatórios</h2>
      {relatorios.length === 0 ? (
        <p>Nenhum relatório ainda.</p>
      ) : (
        <table>
          <caption>Relatórios executivos, do mais recente para o mais antigo</caption>
          <thead>
            <tr>
              <th scope="col">Mês</th>
              <th scope="col">Situação</th>
              <th scope="col">Gerado em</th>
              <th scope="col">Aprovado por</th>
            </tr>
          </thead>
          <tbody>
            {relatorios.map((r) => (
              <tr key={r.id}>
                <th scope="row">
                  <a href={`/rel/relatorio-executivo/${r.id}`}>{`${r.mes.slice(5, 7)}/${r.mes.slice(0, 4)}`}</a>
                </th>
                <td>{r.situacao === 'APROVADO' ? 'Aprovado' : 'Rascunho'}</td>
                <td>{dataEmBrasilia(r.geradoEm)}</td>
                <td>{r.aprovadoEm ? `${r.aprovadoRotulo ?? ''} em ${dataEmBrasilia(r.aprovadoEm)}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
