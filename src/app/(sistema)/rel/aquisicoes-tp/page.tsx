import { obterAquisicoesTp, PORTA_REALIZADO, TabelaAquisicoes } from '@/modules/rel';
import { exigirPagina } from '@/shared/authz';

// Demonstrativo de aquisições do TP (US-097 parte 2; UC05.04): filtros na URL
// (?tp=TP-3&de=2026-09&ate=2027-02&conta=1.2.3&descricao=notebook&zerados=sim).
type Busca = { tp?: string; de?: string; ate?: string; conta?: string; descricao?: string; zerados?: string };

export default async function AquisicoesTp({ searchParams }: { searchParams: Promise<Busca> }) {
  const ctx = await exigirPagina('rel.aquisicoes_tp', 'consultar');
  const tela = await obterAquisicoesTp(ctx, await searchParams, PORTA_REALIZADO);
  const r = tela.relatorio;
  const f = tela.filtros;
  const qs = r
    ? new URLSearchParams({
        tp: r.tp.numero,
        de: f.de,
        ate: f.ate,
        ...(f.conta ? { conta: f.conta } : {}),
        ...(f.descricao ? { descricao: f.descricao } : {}),
        ...(f.exibirZerados ? { zerados: 'sim' } : {}),
      }).toString()
    : '';
  return (
    <div>
      <h1>Demonstrativo de aquisições do TP</h1>
      <p>
        Os bens previstos na versão oficializada, por conta do Imobilizado/Intangível e mês, com o realizado de cada conta no período. Só TPs
        com versão oficial.
      </p>
      <form method="get" action="/rel/aquisicoes-tp">
        <p>
          <label htmlFor="aquisicoes-tp">Termo de Parceria</label>{' '}
          <select id="aquisicoes-tp" name="tp" defaultValue={f.tp} required>
            <option value="">Escolha…</option>
            {tela.tps.map((t) => (
              <option key={t.numero} value={t.numero}>
                {t.numero} – {t.objeto}
              </option>
            ))}
          </select>{' '}
          <label htmlFor="aquisicoes-de">De</label> <input id="aquisicoes-de" name="de" type="month" defaultValue={f.de} />{' '}
          <label htmlFor="aquisicoes-ate">Até</label> <input id="aquisicoes-ate" name="ate" type="month" defaultValue={f.ate} />{' '}
          <label htmlFor="aquisicoes-conta">Conta</label> <input id="aquisicoes-conta" name="conta" maxLength={80} defaultValue={f.conta} />{' '}
          <label htmlFor="aquisicoes-descricao">Descrição do bem</label>{' '}
          <input id="aquisicoes-descricao" name="descricao" maxLength={80} defaultValue={f.descricao} />{' '}
          <label>
            <input type="checkbox" name="zerados" value="sim" defaultChecked={f.exibirZerados} /> Exibir contas zeradas
          </label>{' '}
          <button type="submit">Consultar</button>
        </p>
      </form>
      {tela.erro && <p role="alert">{tela.erro}</p>}
      {r && ctx.permissoes.has('rel.aquisicoes_tp:exportar') && (
        <p>
          Exportar: <a href={`/rel/aquisicoes-tp/exportar?${qs}&formato=xlsx`}>XLSX</a> · <a href={`/rel/aquisicoes-tp/exportar?${qs}&formato=csv`}>CSV</a> ·{' '}
          <a href={`/rel/aquisicoes-tp/exportar?${qs}&formato=pdf`}>PDF</a>
        </p>
      )}
      {r && <TabelaAquisicoes relatorio={r} />}
    </div>
  );
}
