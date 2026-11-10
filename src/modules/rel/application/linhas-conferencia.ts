import type { ResumoCadastros } from '@/modules/cad';
import type { IdentificacaoExportacao, PlanilhaExportacao } from '@/modules/ger';

// Linhas do relatório de conferência da carga (plano do P7, Task 2; US-115): as mesmas na tela e
// na exportação, para a GFIN conferir o que vê com o que assina. Quantidades como texto inteiro;
// dinheiro como texto decimal do kernel (C3).
// `oculto`: valor que existe, mas não é mostrado: sem a permissão ('oculta', R24) ou sem a chave de
// cifra ('indisponivel').
export type LinhaConferencia = { secao: string; item: string; quantidade: string | null; valor: string | null; oculto?: 'oculta' | 'indisponivel' };

const SIM_NAO = (b: boolean) => (b ? 'sim' : 'não');

export function linhasConferencia(r: ResumoCadastros): LinhaConferencia[] {
  const linhas: LinhaConferencia[] = [];
  const add = (secao: string, item: string, quantidade: number | string | null, valor: string | null = null) =>
    linhas.push({ secao, item, quantidade: quantidade === null ? null : String(quantidade), valor });

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
  // Sem cad.salarios:consultar, a soma não é decifrada nem exibida (R24). Sem a chave de cifra, ela
  // aparece como indisponível, nunca como 0,00.
  const soma = r.cargos.somaSalarioReal;
  const ROTULO_SOMA = 'Soma dos salários reais dos cargos ativos';
  if (soma.situacao === 'calculada') {
    add('Cargos', ROTULO_SOMA, null, soma.total);
    if (soma.ilegiveis > 0) add('Cargos', 'Salários reais ilegíveis (fora da soma)', soma.ilegiveis);
  } else {
    linhas.push({ secao: 'Cargos', item: ROTULO_SOMA, quantidade: null, valor: null, oculto: soma.situacao });
  }
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

const MOTIVO = { oculta: 'oculto: sem permissão de consultar salários', indisponivel: 'indisponível: chave de cifra não configurada' } as const;

export function planilhaConferencia(r: ResumoCadastros, ano: number, identificacao?: IdentificacaoExportacao): PlanilhaExportacao {
  return {
    nome: `Conferência ${ano}`,
    ...(identificacao ? { identificacao } : {}),
    colunas: [
      { titulo: 'Seção', tipo: 'texto', largura: 160 },
      { titulo: 'Item', tipo: 'texto', largura: 320 },
      { titulo: 'Quantidade', tipo: 'texto', largura: 90 },
      { titulo: 'Valor', tipo: 'dinheiro', largura: 120 },
    ],
    linhas: linhasConferencia(r).map((l) => [l.secao, l.oculto ? `${l.item} (${MOTIVO[l.oculto]})` : l.item, l.quantidade, l.valor]),
  };
}
