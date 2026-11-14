import { obterSalariosTp, CATEGORIAS_PESSOAL, PORTA_PESSOAL, ROTULO_CATEGORIA, TabelaSalarios } from '@/modules/rel';
import { exigirPagina } from '@/shared/authz';

// Salários dos empregados do TP (US-098; UC05.05): filtros na URL (?tp=TP-3&de=2026-09&ate=2027-02&cargo=analista&meta=1&categoria=EMPREGADO).
type Busca = { tp?: string; de?: string; ate?: string; cargo?: string; meta?: string; categoria?: string };

export default async function SalariosTp({ searchParams }: { searchParams: Promise<Busca> }) {
  const ctx = await exigirPagina('rel.salarios_tp', 'consultar');
  const tela = await obterSalariosTp(ctx, await searchParams, PORTA_PESSOAL);
  const r = tela.relatorio;
  const f = tela.filtros;
  const qs = r
    ? new URLSearchParams({
        tp: r.tp.numero,
        de: f.de,
        ate: f.ate,
        ...(f.cargo ? { cargo: f.cargo } : {}),
        ...(f.meta ? { meta: f.meta } : {}),
        ...(f.categoria ? { categoria: f.categoria } : {}),
      }).toString()
    : '';
  return (
    <div>
      <h1>Salários dos empregados do TP</h1>
      <p>O custo mensal previsto de cada empregado do Termo de Parceria, pela versão oficializada da proposta (não é a folha de pagamento). Só TPs com versão oficial.</p>
      <form method="get" action="/rel/salarios-tp">
        <p>
          <label htmlFor="salarios-tp">Termo de Parceria</label>{' '}
          <select id="salarios-tp" name="tp" defaultValue={f.tp} required>
            <option value="">Escolha…</option>
            {tela.tps.map((t) => (
              <option key={t.numero} value={t.numero}>
                {t.numero} – {t.objeto}
              </option>
            ))}
          </select>{' '}
          <label htmlFor="salarios-de">De</label> <input id="salarios-de" name="de" type="month" defaultValue={f.de} />{' '}
          <label htmlFor="salarios-ate">Até</label> <input id="salarios-ate" name="ate" type="month" defaultValue={f.ate} />{' '}
          <label htmlFor="salarios-cargo">Cargo</label> <input id="salarios-cargo" name="cargo" maxLength={80} defaultValue={f.cargo} />{' '}
          <label htmlFor="salarios-meta">Meta</label> <input id="salarios-meta" name="meta" maxLength={80} defaultValue={f.meta} />{' '}
          <label htmlFor="salarios-categoria">Categoria</label>{' '}
          <select id="salarios-categoria" name="categoria" defaultValue={f.categoria}>
            <option value="">Todas</option>
            {CATEGORIAS_PESSOAL.map((c) => (
              <option key={c} value={c}>
                {ROTULO_CATEGORIA[c]}
              </option>
            ))}
          </select>{' '}
          <button type="submit">Consultar</button>
        </p>
      </form>
      {tela.erro && <p role="alert">{tela.erro}</p>}
      {r && ctx.permissoes.has('rel.salarios_tp:exportar') && (
        <p>
          Exportar: <a href={`/rel/salarios-tp/exportar?${qs}&formato=xlsx`}>XLSX</a> · <a href={`/rel/salarios-tp/exportar?${qs}&formato=csv`}>CSV</a> ·{' '}
          <a href={`/rel/salarios-tp/exportar?${qs}&formato=pdf`}>PDF</a>
        </p>
      )}
      {r && <TabelaSalarios relatorio={r} />}
    </div>
  );
}
