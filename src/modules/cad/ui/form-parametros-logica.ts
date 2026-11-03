// Lógica pura dos formulários de parâmetros e do salário mínimo (US-053 parte 2), sem React.
import type { ErroCampo } from '@/shared/kernel';

export type RespostaSalvar = { ok: true; valor: { versao: number } } | { ok: false; erros: readonly ErroCampo[] };
export type EstadoSalvar = { versao: number; erros: readonly ErroCampo[]; salvo: boolean };

/** Depois de salvar: a versão nova fica para a próxima gravação (senão, falso aviso de concorrência). */
export function depoisDeSalvar(antes: EstadoSalvar, r: RespostaSalvar): EstadoSalvar {
  return r.ok ? { versao: r.valor.versao, erros: [], salvo: true } : { versao: antes.versao, erros: r.erros, salvo: false };
}

// Campos que o formulário de parâmetros mostra ao lado de algum controle; o resto vai para o resumo.
const EXIBIDOS = /^(reajuste|ipca|diasUteisMes|mesDataBase|semaforo(\.(verdeAte|amareloAte|laranjaAte))?|encargos(\.\d+\.(percentual|conta))?|contas\.(salario|adicional|ferias|decimo_terceiro))$/;
export const campoExibido = (campo: string) => EXIBIDOS.test(campo);

/** Texto dos dias úteis → número enviado; fora do formato vira 0, que o domínio recusa com a mensagem da faixa. */
export const diasUteisDoTexto = (t: string) => (/^\d{1,3}$/.test(t.trim()) ? Number(t.trim()) : 0);
