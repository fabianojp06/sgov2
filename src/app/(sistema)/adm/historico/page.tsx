import { BotaoImprimir, consultaDaUrl, consultarHistorico, lerFiltroHistorico, registrarImpressaoHistorico, TelaHistorico } from '@/modules/adm';
import { exigirPagina } from '@/shared/authz';

// Histórico de Operações (US-040, UC02.24): só leitura, com imprimir e exportar.
export default async function Historico({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await exigirPagina('adm.historico', 'consultar');
  const { filtro, valores } = lerFiltroHistorico(await searchParams, new Date());
  const r = await consultarHistorico(ctx, filtro);
  const parametros = Object.fromEntries(Object.entries(valores).filter(([, v]) => v !== ''));
  return (
    <TelaHistorico
      pagina={r.ok ? r.valor : null}
      valores={valores}
      erro={r.ok ? undefined : r.erros[0]?.mensagem}
      hrefPagina={(n) => `/adm/historico?${consultaDaUrl(valores, { pagina: String(n) })}`}
      hrefExportar={ctx.permissoes.has('adm.historico:exportar') ? `/adm/historico/exportar?${consultaDaUrl(valores)}` : undefined}
      imprimir={ctx.permissoes.has('adm.historico:imprimir') ? <BotaoImprimir registrar={registrarImpressaoHistorico} parametros={parametros} /> : undefined}
    />
  );
}
