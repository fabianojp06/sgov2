import { acaoAlterarParametroLocal, FormParametroLocal, obterTelaParametrosLocais } from '@/modules/cad';
import { exigirPagina } from '@/shared/authz';

// Parâmetros locais das contas analíticas (US-045; RF_PLA_REQ_003, C7, C27): natureza OPEX/CAPEX e
// faixas do semáforo próprias. A conta em edição vem da URL (?conta=4.1.1.1.001).
export default async function ParametrosLocais({ searchParams }: { searchParams: Promise<{ conta?: string | string[] }> }) {
  const ctx = await exigirPagina('cad.plano_contas', 'consultar');
  const [{ contas, faixasExercicio }, { conta: pedida }] = await Promise.all([obterTelaParametrosLocais(ctx), searchParams]);
  const atual = typeof pedida === 'string' ? contas.find((c) => c.classificacao === pedida) : undefined;
  const podeAlterar = ctx.permissoes.has('cad.plano_contas:executar');
  return (
    <div>
      <h1>Parâmetros locais das contas</h1>
      <p>
        <a href="/cad/plano-contas">Voltar ao plano de contas</a>
      </p>
      <p>
        Natureza OPEX/CAPEX e faixas do semáforo próprias de cada conta analítica, para orientar os relatórios. A estrutura do plano de contas
        não muda aqui.
      </p>
      {typeof pedida === 'string' && !atual && <p role="alert">Conta não encontrada ou não é analítica ativa.</p>}
      {atual && <FormParametroLocal key={atual.contaId} conta={atual} faixasExercicio={faixasExercicio} podeAlterar={podeAlterar} alterar={acaoAlterarParametroLocal} />}
      <table aria-label="Parâmetros locais das contas analíticas">
        <thead>
          <tr>
            <th scope="col">Conta</th>
            <th scope="col">Descrição</th>
            <th scope="col">Natureza</th>
            <th scope="col">Faixas do semáforo</th>
            <th scope="col">Ação</th>
          </tr>
        </thead>
        <tbody>
          {contas.map((c) => (
            <tr key={c.contaId} {...(atual?.contaId === c.contaId ? { 'aria-current': true } : {})}>
              <td>{c.classificacao}</td>
              <td>{c.descricao}</td>
              <td>{c.natureza ?? '—'}</td>
              <td>{c.semaforo ? `${c.semaforo.verdeAte}% / ${c.semaforo.amareloAte}% / ${c.semaforo.laranjaAte}%` : 'do exercício'}</td>
              <td>
                <a href={`/cad/plano-contas/parametros-locais?conta=${encodeURIComponent(c.classificacao)}`} aria-label={`${podeAlterar ? 'Alterar' : 'Ver'} parâmetros da conta ${c.classificacao}`}>
                  {podeAlterar ? 'Alterar' : 'Ver'}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
