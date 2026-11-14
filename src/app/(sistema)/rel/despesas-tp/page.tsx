import { obterDespesasTp, PORTA_REALIZADO, TabelaDespesas } from '@/modules/rel';
import { exigirPagina } from '@/shared/authz';

// Demonstrativo de despesas do TP (US-096 parte 1; UC05.02): filtros na URL (?tp=TP-3&de=2026-09&ate=2027-02&zerados=sim).
type Busca = { tp?: string; de?: string; ate?: string; zerados?: string };

export default async function DespesasTp({ searchParams }: { searchParams: Promise<Busca> }) {
  const ctx = await exigirPagina('rel.despesas_tp', 'consultar');
  const busca = await searchParams;
  const tela = await obterDespesasTp(ctx, busca, PORTA_REALIZADO);
  const r = tela.relatorio;
  const qs = r
    ? new URLSearchParams({ tp: r.tp.numero, de: tela.filtros.de, ate: tela.filtros.ate, ...(tela.filtros.exibirZerados ? { zerados: 'sim' } : {}) }).toString()
    : '';
  return (
    <div>
      <h1>Demonstrativo de despesas do TP</h1>
      <p>O realizado de cada conta do Termo de Parceria, do início ao ano anterior e mês a mês no ano de referência. Só TPs com versão oficial.</p>
      <form method="get" action="/rel/despesas-tp">
        <p>
          <label htmlFor="despesas-tp">Termo de Parceria</label>{' '}
          <select id="despesas-tp" name="tp" defaultValue={tela.filtros.tp} required>
            <option value="">Escolha…</option>
            {tela.tps.map((t) => (
              <option key={t.numero} value={t.numero}>
                {t.numero} – {t.objeto}
              </option>
            ))}
          </select>{' '}
          <label htmlFor="despesas-de">De</label> <input id="despesas-de" name="de" type="month" defaultValue={tela.filtros.de} />{' '}
          <label htmlFor="despesas-ate">Até</label> <input id="despesas-ate" name="ate" type="month" defaultValue={tela.filtros.ate} />{' '}
          <label>
            <input type="checkbox" name="zerados" value="sim" defaultChecked={tela.filtros.exibirZerados} /> Exibir contas zeradas
          </label>{' '}
          <button type="submit">Consultar</button>
        </p>
      </form>
      {tela.erro && <p role="alert">{tela.erro}</p>}
      {r && ctx.permissoes.has('rel.despesas_tp:exportar') && (
        <p>
          Exportar: <a href={`/rel/despesas-tp/exportar?${qs}&formato=xlsx`}>XLSX</a> · <a href={`/rel/despesas-tp/exportar?${qs}&formato=csv`}>CSV</a> ·{' '}
          <a href={`/rel/despesas-tp/exportar?${qs}&formato=pdf`}>PDF</a>
        </p>
      )}
      {r && <TabelaDespesas relatorio={r} />}
    </div>
  );
}
