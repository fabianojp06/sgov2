import {
  AVISOS_EXPORTACAO_HISTORICO,
  BotaoImprimir,
  consultaDaUrl,
  consultarHistorico,
  lerFiltroHistorico,
  MENSAGEM_EXPORTACAO_AGENDADA,
  registrarImpressaoHistorico,
  TelaHistorico,
} from '@/modules/adm';
import { exigirPagina } from '@/shared/authz';

// Histórico de Operações (US-040, UC02.24): só leitura, com imprimir e exportar.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Historico({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await exigirPagina('adm.historico', 'consultar');
  const parametrosUrl = await searchParams;
  const { filtro, valores } = lerFiltroHistorico(parametrosUrl, new Date());
  const aviso = typeof parametrosUrl.aviso === 'string' ? parametrosUrl.aviso : undefined;
  // Exportação agendada (US-024): o aviso aponta para o pedido em Minhas exportações.
  const pedido = aviso === 'exportacao-agendada' && typeof parametrosUrl.pedido === 'string' && UUID.test(parametrosUrl.pedido) ? parametrosUrl.pedido : undefined;
  const r = await consultarHistorico(ctx, filtro);
  const parametros = Object.fromEntries(Object.entries(valores).filter(([, v]) => v !== ''));
  return (
    <TelaHistorico
      pagina={r.ok ? r.valor : null}
      valores={valores}
      erro={r.ok ? (aviso !== undefined && Object.hasOwn(AVISOS_EXPORTACAO_HISTORICO, aviso) ? AVISOS_EXPORTACAO_HISTORICO[aviso] : undefined) : r.erros[0]?.mensagem}
      agendada={pedido ? { mensagem: MENSAGEM_EXPORTACAO_AGENDADA, href: `/rel/exportacoes?pedido=${pedido}` } : undefined}
      hrefPagina={(n) => `/adm/historico?${consultaDaUrl(valores, { pagina: String(n) })}`}
      hrefExportar={ctx.permissoes.has('adm.historico:exportar') ? `/adm/historico/exportar?${consultaDaUrl(valores)}` : undefined}
      imprimir={ctx.permissoes.has('adm.historico:imprimir') ? <BotaoImprimir registrar={registrarImpressaoHistorico} parametros={parametros} /> : undefined}
    />
  );
}
