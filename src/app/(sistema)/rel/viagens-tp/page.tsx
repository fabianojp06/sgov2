import { obterViagensTp, PORTA_REALIZADO, TabelaViagens } from '@/modules/rel';
import { exigirPagina } from '@/shared/authz';

// Demonstrativo analítico de despesas com viagens do TP (US-097 parte 1; UC05.03): filtros na URL
// (?tp=TP-3&de=2026-09&ate=2027-02&texto=passagem&zerados=sim).
type Busca = { tp?: string; de?: string; ate?: string; texto?: string; zerados?: string };

export default async function ViagensTp({ searchParams }: { searchParams: Promise<Busca> }) {
  const ctx = await exigirPagina('rel.viagens_tp', 'consultar');
  const busca = await searchParams;
  const tela = await obterViagensTp(ctx, busca, PORTA_REALIZADO);
  const r = tela.relatorio;
  const qs = r
    ? new URLSearchParams({
        tp: r.tp.numero,
        de: tela.filtros.de,
        ate: tela.filtros.ate,
        ...(tela.filtros.texto ? { texto: tela.filtros.texto } : {}),
        ...(tela.filtros.exibirZerados ? { zerados: 'sim' } : {}),
      }).toString()
    : '';
  return (
    <div>
      <h1>Demonstrativo de despesas com viagens do TP</h1>
      <p>
        O realizado das contas de viagens e diárias do Termo de Parceria, agrupadas por subcategoria, do início ao ano anterior e mês a mês no ano
        de referência. Só TPs com versão oficial.
      </p>
      <form method="get" action="/rel/viagens-tp">
        <p>
          <label htmlFor="viagens-tp">Termo de Parceria</label>{' '}
          <select id="viagens-tp" name="tp" defaultValue={tela.filtros.tp} required>
            <option value="">Escolha…</option>
            {tela.tps.map((t) => (
              <option key={t.numero} value={t.numero}>
                {t.numero} – {t.objeto}
              </option>
            ))}
          </select>{' '}
          <label htmlFor="viagens-de">De</label> <input id="viagens-de" name="de" type="month" defaultValue={tela.filtros.de} />{' '}
          <label htmlFor="viagens-ate">Até</label> <input id="viagens-ate" name="ate" type="month" defaultValue={tela.filtros.ate} />{' '}
          <label htmlFor="viagens-texto">Conta ou descrição</label>{' '}
          <input id="viagens-texto" name="texto" maxLength={80} defaultValue={tela.filtros.texto} />{' '}
          <label>
            <input type="checkbox" name="zerados" value="sim" defaultChecked={tela.filtros.exibirZerados} /> Exibir contas zeradas
          </label>{' '}
          <button type="submit">Consultar</button>
        </p>
      </form>
      {tela.erro && <p role="alert">{tela.erro}</p>}
      {r && ctx.permissoes.has('rel.viagens_tp:exportar') && (
        <p>
          Exportar: <a href={`/rel/viagens-tp/exportar?${qs}&formato=xlsx`}>XLSX</a> · <a href={`/rel/viagens-tp/exportar?${qs}&formato=csv`}>CSV</a> ·{' '}
          <a href={`/rel/viagens-tp/exportar?${qs}&formato=pdf`}>PDF</a>
        </p>
      )}
      {r && <TabelaViagens relatorio={r} />}
    </div>
  );
}
