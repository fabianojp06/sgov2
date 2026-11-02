import { Percentual } from '@/shared/kernel';
import type { ComponenteEncargo, ComponenteFixo } from './custo-pessoal';
import { COMPONENTES_COM_CONTA, percentualDoTexto, type ParametrosExercicio } from './parametros';

// Os parâmetros do exercício como dados da tela (US-053 parte 2; plano do P4, Task 9b): só texto e
// números, para ir ao componente cliente. Percentuais em pontos ("38" = 38%).

export type ComponenteComConta = (typeof COMPONENTES_COM_CONTA)[number];

export type ParametrosTela = {
  ano: number;
  versao: number;
  congelado: boolean;
  provisorio: boolean;
  /** Componentes cujo valor ou conta ainda é o padrão provisório (selo "Provisório"). */
  provisorios: readonly ComponenteFixo[];
  reajuste: string;
  mesDataBase: number;
  ipca: string;
  diasUteisMes: number;
  semaforo: { verdeAte: string; amareloAte: string; laranjaAte: string };
  encargos: readonly { componente: ComponenteEncargo; nome: string; percentual: string; conta: string }[];
  contas: Readonly<Record<ComponenteComConta, string>>;
};

/** Conta analítica ativa que pode receber um componente (C1). */
export type OpcaoConta = { classificacao: string; descricao: string };

export const ROTULO_COMPONENTE: Readonly<Record<ComponenteComConta, string>> = {
  salario: 'Salário',
  adicional: 'Adicional',
  ferias: 'Férias',
  decimo_terceiro: '13º salário',
};

export function paraTela(p: ParametrosExercicio): ParametrosTela {
  return {
    ano: p.ano,
    versao: p.versao,
    congelado: p.congelado,
    provisorio: p.provisorio,
    provisorios: p.provisorios,
    reajuste: p.reajuste.paraString(),
    mesDataBase: p.mesDataBase,
    ipca: p.ipca.paraString(),
    diasUteisMes: p.diasUteisMes,
    semaforo: { verdeAte: p.semaforo.verdeAte.paraString(), amareloAte: p.semaforo.amareloAte.paraString(), laranjaAte: p.semaforo.laranjaAte.paraString() },
    encargos: p.encargos.map((e) => ({ componente: e.componente, nome: e.nome, percentual: e.percentual.paraString(), conta: e.conta })),
    contas: p.contas,
  };
}

/** Total dos encargos digitados ("43,50%"), ou null se algum não estiver no formato. */
export function totalEncargos(percentuais: readonly string[]): string | null {
  let pontos = Percentual.dePontos('0').comoFracao();
  for (const t of percentuais) {
    const p = percentualDoTexto(t);
    if (!p) return null;
    pontos = pontos.plus(p.comoFracao());
  }
  return Percentual.dePontos(pontos.times(100)).formatar();
}
