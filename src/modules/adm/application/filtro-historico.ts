import { TIPOS_OPERACAO, type TipoOperacao } from '@/shared/audit';
import type { FiltroHistorico } from './historico';

// Filtros da tela do Histórico (US-040) vindos da URL (?usuario=&funcionalidade=&tipo=&de=&ate=&pagina=).
// As datas são dias no horário de Brasília: `de` começa às 00:00 e `ate` vai até o fim do dia. Sem
// datas, os últimos 30 dias. Valor fora do formato é ignorado (a tela volta ao padrão), nunca confiado.
export type ParametrosHistorico = Readonly<Record<string, string | string[] | undefined>>;
export type ValoresFiltro = { usuario: string; funcionalidade: string; tipo: string; de: string; ate: string };

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const CODIGO = /^[a-z]{3}\.[a-z0-9_]{1,57}$/;
const DIA_BRASILIA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });

const um = (v: string | string[] | undefined): string => (typeof v === 'string' ? v.trim() : '');
const inicioDoDia = (dia: string) => new Date(`${dia}T00:00:00.000-03:00`);
const fimDoDia = (dia: string) => new Date(`${dia}T23:59:59.999-03:00`);
const diaValido = (dia: string) => DIA.test(dia) && !Number.isNaN(inicioDoDia(dia).getTime()) && inicioDoDia(dia).toISOString().slice(0, 10) === dia;

export function lerFiltroHistorico(p: ParametrosHistorico, agora: Date): { filtro: FiltroHistorico; valores: ValoresFiltro } {
  const hoje = DIA_BRASILIA.format(agora);
  const trintaDias = DIA_BRASILIA.format(new Date(agora.getTime() - 29 * 24 * 60 * 60 * 1000));
  const de = diaValido(um(p.de)) ? um(p.de) : trintaDias;
  const ate = diaValido(um(p.ate)) ? um(p.ate) : hoje;
  const usuario = um(p.usuario).slice(0, 120);
  const funcionalidade = CODIGO.test(um(p.funcionalidade)) ? um(p.funcionalidade) : '';
  const tipo = (TIPOS_OPERACAO as readonly string[]).includes(um(p.tipo)) ? (um(p.tipo) as TipoOperacao) : undefined;
  const pagina = /^\d{1,7}$/.test(um(p.pagina)) ? Number(um(p.pagina)) : 1;
  return {
    filtro: {
      de: inicioDoDia(de),
      ate: fimDoDia(ate),
      pagina,
      ...(usuario ? { usuario } : {}),
      ...(funcionalidade ? { funcionalidade } : {}),
      ...(tipo ? { tipo } : {}),
    },
    valores: { usuario, funcionalidade, tipo: tipo ?? '', de, ate },
  };
}

// A mesma busca em outra página ou na exportação (links da tela).
export function consultaDaUrl(v: ValoresFiltro, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  for (const [k, valor] of Object.entries({ ...v, ...extra })) if (valor) q.set(k, valor);
  return q.toString();
}
