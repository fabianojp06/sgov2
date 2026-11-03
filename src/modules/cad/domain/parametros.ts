import { Dinheiro, falha, ok, Percentual, type ErroCampo, type Resultado } from '@/shared/kernel';
import { COMPONENTES_FIXOS, type ComponenteEncargo, type ComponenteFixo, type PremissasExercicio } from './custo-pessoal';
import type { FaixasSemaforo } from './semaforo';

// Parâmetros por exercício (US-053; plano do P4, Task 9a). Validação pura da entrada da tela; a
// conta de cada componente é conferida pela função injetada (índice do C1: analítica ativa).

export const ENCARGOS = COMPONENTES_FIXOS.filter((c): c is ComponenteEncargo => c.startsWith('encargo.'));
export const COMPONENTES_COM_CONTA = COMPONENTES_FIXOS.filter(
  (c): c is Exclude<ComponenteFixo, ComponenteEncargo> => !c.startsWith('encargo.'),
);

/** O que a tela manda: números como texto (ponto ou vírgula decimal), nunca number para valor. */
export type EntradaParametros = {
  reajuste: string;
  mesDataBase: number;
  ipca: string;
  diasUteisMes: number;
  semaforo: { verdeAte: string; amareloAte: string; laranjaAte: string };
  encargos: readonly { componente: ComponenteEncargo; percentual: string; conta: string }[];
  contas: Readonly<Record<Exclude<ComponenteFixo, ComponenteEncargo>, string>>;
};

export type ParametrosValidados = {
  reajuste: Percentual;
  mesDataBase: number;
  ipca: Percentual;
  diasUteisMes: number;
  semaforo: FaixasSemaforo;
  encargos: readonly { componente: ComponenteEncargo; percentual: Percentual; conta: string }[];
  contas: Readonly<Record<Exclude<ComponenteFixo, ComponenteEncargo>, string>>;
};

/** Parâmetros completos do exercício, como a tela os mostra. */
export type ParametrosExercicio = Omit<PremissasExercicio, 'beneficios' | 'avisos'> & {
  diasUteisMes: number;
  semaforo: FaixasSemaforo;
  /** Componentes com dado provisório (R14, GAP-CAR-005): a tela mostra o selo "Provisório". */
  provisorios: readonly ComponenteFixo[];
};

const TEXTO_PERCENTUAL = /^-?\d{1,5}(\.\d{1,4})?$/;
const TEXTO_DINHEIRO = /^\d{1,13}(\.\d{1,2})?$/;
const normalizar = (s: string) => {
  const t = s.trim();
  return t.includes(',') && !t.includes('.') ? t.replace(',', '.') : t;
};

/** O percentual digitado (ponto ou vírgula decimal), ou null se não estiver no formato. */
export function percentualDoTexto(texto: string): Percentual | null {
  const t = normalizar(texto);
  return TEXTO_PERCENTUAL.test(t) ? Percentual.dePontos(t) : null;
}

function percentual(campo: string, texto: string, min: number, max: number, erros: ErroCampo[]): Percentual | null {
  const t = normalizar(texto);
  if (!TEXTO_PERCENTUAL.test(t)) {
    erros.push({ campo, mensagem: 'Informe um percentual com até 4 casas decimais.' });
    return null;
  }
  const p = Percentual.dePontos(t);
  if (p.comoFracao().times(100).lt(min) || p.comoFracao().times(100).gt(max)) {
    erros.push({ campo, mensagem: `O percentual deve ficar entre ${min} e ${max}.` });
    return null;
  }
  return p;
}

function inteiro(campo: string, v: number, min: number, max: number, mensagem: string, erros: ErroCampo[]): void {
  if (!Number.isInteger(v) || v < min || v > max) erros.push({ campo, mensagem });
}

export function validarParametros(e: EntradaParametros, contaValida: (classificacao: string) => boolean): Resultado<ParametrosValidados> {
  const erros: ErroCampo[] = [];
  const reajuste = percentual('reajuste', e.reajuste, 0, 100, erros);
  const ipca = percentual('ipca', e.ipca, -100, 100, erros);
  inteiro('mesDataBase', e.mesDataBase, 1, 12, 'O mês da data-base deve ser de 1 a 12.', erros);
  inteiro('diasUteisMes', e.diasUteisMes, 1, 31, 'Os dias úteis do mês devem ser de 1 a 31.', erros);

  const verde = percentual('semaforo.verdeAte', e.semaforo.verdeAte, 0, 999, erros);
  const amarelo = percentual('semaforo.amareloAte', e.semaforo.amareloAte, 0, 999, erros);
  const laranja = percentual('semaforo.laranjaAte', e.semaforo.laranjaAte, 0, 999, erros);
  if (verde && amarelo && laranja && !(verde.comoFracao().lt(amarelo.comoFracao()) && amarelo.comoFracao().lt(laranja.comoFracao()))) {
    erros.push({ campo: 'semaforo', mensagem: 'As faixas do semáforo devem estar em ordem: verde < amarelo < laranja.' });
  }

  const encargos: { componente: ComponenteEncargo; percentual: Percentual; conta: string }[] = [];
  const vistos = new Set<string>();
  e.encargos.forEach((enc, i) => {
    if (!(ENCARGOS as readonly string[]).includes(enc.componente) || vistos.has(enc.componente)) {
      erros.push({ campo: `encargos.${i}.componente`, mensagem: 'Encargo desconhecido ou repetido.' });
      return;
    }
    vistos.add(enc.componente);
    const p = percentual(`encargos.${i}.percentual`, enc.percentual, 0, 100, erros);
    if (!contaValida(enc.conta)) erros.push({ campo: `encargos.${i}.conta`, mensagem: 'A conta deve ser analítica e ativa.' });
    if (p) encargos.push({ componente: enc.componente, percentual: p, conta: enc.conta });
  });
  if (ENCARGOS.some((c) => !vistos.has(c))) erros.push({ campo: 'encargos', mensagem: 'Informe os 5 encargos.' });
  const soma = encargos.reduce((t, x) => t.plus(x.percentual.comoFracao()), Percentual.dePontos('0').comoFracao());
  if (soma.gt(1)) erros.push({ campo: 'encargos', mensagem: 'A soma dos encargos não pode passar de 100%.' });

  for (const c of COMPONENTES_COM_CONTA) {
    if (typeof e.contas[c] !== 'string' || !contaValida(e.contas[c])) erros.push({ campo: `contas.${c}`, mensagem: 'A conta deve ser analítica e ativa.' });
  }
  for (const c of Object.keys(e.contas)) {
    if (!(COMPONENTES_COM_CONTA as readonly string[]).includes(c)) erros.push({ campo: `contas.${c}`, mensagem: 'Componente desconhecido.' });
  }

  if (erros.length > 0 || !reajuste || !ipca || !verde || !amarelo || !laranja) return falha(erros);
  return ok({
    reajuste,
    mesDataBase: e.mesDataBase,
    ipca,
    diasUteisMes: e.diasUteisMes,
    semaforo: { verdeAte: verde, amareloAte: amarelo, laranjaAte: laranja },
    encargos,
    contas: Object.fromEntries(COMPONENTES_COM_CONTA.map((c) => [c, e.contas[c]])) as ParametrosValidados['contas'],
  });
}

/** Salário mínimo nacional do exercício (RN_CAR_11): maior que zero, com até 2 casas. */
export function validarSalarioMinimo(texto: string): Resultado<Dinheiro> {
  const t = normalizar(texto);
  if (!TEXTO_DINHEIRO.test(t)) return falha([{ campo: 'salarioMinimo', mensagem: 'Informe o valor com até 2 casas decimais.' }]);
  const v = Dinheiro.de(t);
  if (v.ehZero()) return falha([{ campo: 'salarioMinimo', mensagem: 'O salário mínimo deve ser maior que zero.' }]);
  if (v.comparar(Dinheiro.de('1000000.00')) >= 0) return falha([{ campo: 'salarioMinimo', mensagem: 'O salário mínimo deve ser menor que 1.000.000,00.' }]);
  return ok(v);
}
