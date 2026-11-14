import { obterReceitasDespesasTp, PORTA_REALIZADO, TabelaReceitasDespesas } from '@/modules/rel';
import { exigirPagina } from '@/shared/authz';

// Demonstrativo de receitas e despesas do TP (US-096 parte 2; UC05.01): filtros na URL (?tp=TP-3&de=2026-09&ate=2027-02&zerados=sim).
type Busca = { tp?: string; de?: string; ate?: string; zerados?: string };

export default async function ReceitasDespesasTp({ searchParams }: { searchParams: Promise<Busca> }) {
  const ctx = await exigirPagina('rel.receitas_despesas_tp', 'consultar');
  const busca = await searchParams;
  const tela = await obterReceitasDespesasTp(ctx, busca, PORTA_REALIZADO);
  const r = tela.relatorio;
  const qs = r
    ? new URLSearchParams({ tp: r.tp.numero, de: tela.filtros.de, ate: tela.filtros.ate, ...(tela.filtros.exibirZerados ? { zerados: 'sim' } : {}) }).toString()
    : '';
  return (
    <div>
      <h1>Demonstrativo de receitas e despesas do TP</h1>
      <p>O cronograma de desembolso e, por conta, o previsto, o realizado e o saldo acumulado do Termo de Parceria. Só TPs com versão oficial.</p>
      <form method="get" action="/rel/receitas-despesas-tp">
        <p>
          <label htmlFor="rd-tp">Termo de Parceria</label>{' '}
          <select id="rd-tp" name="tp" defaultValue={tela.filtros.tp} required>
            <option value="">Escolha…</option>
            {tela.tps.map((t) => (
              <option key={t.numero} value={t.numero}>
                {t.numero} – {t.objeto}
              </option>
            ))}
          </select>{' '}
          <label htmlFor="rd-de">De</label> <input id="rd-de" name="de" type="month" defaultValue={tela.filtros.de} />{' '}
          <label htmlFor="rd-ate">Até</label> <input id="rd-ate" name="ate" type="month" defaultValue={tela.filtros.ate} />{' '}
          <label>
            <input type="checkbox" name="zerados" value="sim" defaultChecked={tela.filtros.exibirZerados} /> Exibir contas zeradas
          </label>{' '}
          <button type="submit">Consultar</button>
        </p>
      </form>
      {tela.erro && <p role="alert">{tela.erro}</p>}
      {r && ctx.permissoes.has('rel.receitas_despesas_tp:exportar') && (
        <p>
          Exportar: <a href={`/rel/receitas-despesas-tp/exportar?${qs}&formato=xlsx`}>XLSX</a> · <a href={`/rel/receitas-despesas-tp/exportar?${qs}&formato=csv`}>CSV</a> ·{' '}
          <a href={`/rel/receitas-despesas-tp/exportar?${qs}&formato=pdf`}>PDF</a>
        </p>
      )}
      {r && <TabelaReceitasDespesas relatorio={r} />}
    </div>
  );
}
