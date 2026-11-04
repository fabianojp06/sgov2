import type { ResumoCadastros } from '@/modules/cad';
import type { PlanilhaExportacao } from '@/modules/ger';

// Linhas do relatório de conferência da carga (plano do P7, Task 2; US-115): as mesmas na tela e
// na exportação, para a GFIN conferir o que vê com o que assina. Quantidades como texto inteiro;
// dinheiro como texto decimal do kernel (C3).
// `oculto`: valor que existe, mas não é mostrado sem a permissão (a soma dos salários, R24).
export type LinhaConferencia = { secao: string; item: string; quantidade: string | null; valor: string | null; oculto?: true };

const SIM_NAO = (b: boolean) => (b ? 'sim' : 'não');

export function linhasConferencia(r: ResumoCadastros): LinhaConferencia[] {
  const linhas: LinhaConferencia[] = [];
  const add = (secao: string, item: string, quantidade: number | string | null, valor: string | null = null, oculto = false) =>
    linhas.push({ secao, item, quantidade: quantidade === null ? null : String(quantidade), valor, ...(oculto ? { oculto: true as const } : {}) });

  for (const n of r.contas) {
    add('Plano de contas', `Nível ${n.nivel}: ativas`, n.ativos);
    add('Plano de contas', `Nível ${n.nivel}: inativas`, n.inativos);
  }
  add('Plano de contas', 'Analíticas ativas', r.contas.reduce((s, n) => s + n.analiticosAtivos, 0));

  for (const n of r.centrosCusto) {
    add('Centros de custo', `Nível ${n.nivel}: ativos`, n.ativos);
    add('Centros de custo', `Nível ${n.nivel}: inativos`, n.inativos);
  }
  add('Centros de custo', 'Analíticos ativos', r.centrosCusto.reduce((s, n) => s + n.analiticosAtivos, 0));
  add('Centros de custo', 'Ativos marcados como provisórios', r.centrosCustoProvisorios);

  add('Cargos', 'Ativos', r.cargos.ativos);
  add('Cargos', 'Inativos', r.cargos.inativos);
  add('Cargos', 'Ativos com salário real', r.cargos.comSalarioReal);
  // Sem cad.salarios:consultar, a soma não é decifrada nem exibida (R24).
  add('Cargos', 'Soma dos salários reais dos cargos ativos', null, r.cargos.somaSalarioReal, r.cargos.somaSalarioReal === null);
  if (r.cargos.salariosIlegiveis > 0) add('Cargos', 'Salários reais ilegíveis (fora da soma)', r.cargos.salariosIlegiveis);
  add('Tabela salarial', 'Faixas ativas de cargos ativos', r.faixasSalariaisAtivas);

  const e = r.exercicio;
  if (e) {
    const s = `Exercício ${e.ano}`;
    add(s, 'Parâmetros provisórios', SIM_NAO(e.provisorio));
    add(s, 'Congelado', SIM_NAO(e.congelado));
    add(s, 'Salário mínimo nacional', null, e.salarioMinimo);
    add(s, 'Encargos cadastrados', e.encargos);
    add(s, 'Benefícios ativos na Tabela Mestre', e.beneficiosAtivos);
    add(s, 'Benefícios ativos em cargos ativos', e.beneficiosCargoAtivos);
  }
  return linhas;
}

export function planilhaConferencia(r: ResumoCadastros, ano: number): PlanilhaExportacao {
  return {
    nome: `Conferência ${ano}`,
    colunas: [
      { titulo: 'Seção', tipo: 'texto', largura: 160 },
      { titulo: 'Item', tipo: 'texto', largura: 320 },
      { titulo: 'Quantidade', tipo: 'texto', largura: 90 },
      { titulo: 'Valor', tipo: 'dinheiro', largura: 120 },
    ],
    linhas: linhasConferencia(r).map((l) => [l.secao, l.oculto ? `${l.item} (oculto: sem permissão de consultar salários)` : l.item, l.quantidade, l.valor]),
  };
}
