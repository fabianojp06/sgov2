import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Dinheiro } from '@/shared/kernel';
import { FormReceita } from './form-receita';
import { ListaReceitas, textoAvisoReceita } from './lista-receitas';
import { exercicioDoAno } from './pagina';

// Tela de receitas (US-060; C35; plano do P6, Task 5).
const acao = async () => ({ ok: true as const, valor: undefined });
const meses = (v: string) => Array.from({ length: 12 }, () => Dinheiro.de(v));
const receita = (id: string, tp: string, v: string) => ({ id, tp, descricao: 'Contrato', meses: meses(v), total: Dinheiro.de(v).multiplicar('12'), liquido: Dinheiro.de(v).multiplicar('12'), versao: 0 });
const props = (p: Partial<Parameters<typeof ListaReceitas>[0]> = {}) => ({
  ano: 2027,
  confirmadas: [receita('r1', '001/2026', '1000.50')],
  previstas: [receita('r2', '002/2026', '10')],
  totalConfirmadoMes: meses('1000.50'),
  totalPrevistoMes: meses('10'),
  editavel: true,
  permissoes: { podeIncluir: true, podeAlterar: true, podeExcluir: true },
  excluir: acao,
  ...p,
});
const html = (p: Partial<Parameters<typeof ListaReceitas>[0]> = {}) => renderToString(createElement(ListaReceitas, props(p)));

describe('ListaReceitas', () => {
  it('confirmadas e previstas em tabelas separadas, com o selo, ISS a definir, totais e o aviso da prevista', () => {
    const h = html();
    expect(h).toContain('<h2>Confirmadas</h2>');
    expect(h).toContain('<h2>Previstas</h2>');
    expect(h.match(/Digitado na transição/g)).toHaveLength(2);
    expect(h).toContain('<td>a definir</td>');
    expect(h).toContain('1.000,50');
    expect(h).toContain('12.006,00');
    expect(h).toContain('Total por mês');
    expect(h).toContain('<abbr title="Janeiro">Jan</abbr>');
    expect(h).toMatch(/<div role="region" aria-labelledby="receitas-confirmadas" tabindex="0" style="overflow-x:auto">/i);
    // Rodapé com o total anual, o ISS e o líquido: 12 × 1.000,50 = 12.006,00.
    expect(h.match(/<tfoot>.*?<\/tfoot>/s)?.[0]).toContain('12.006,00');
    expect(h).toContain('Receita prevista não entra no saldo nem no teto.');
  });

  it('Nova, Alterar e Excluir só com a permissão e o exercício editável', () => {
    expect(html()).toContain('href="/orc/receitas/novo?ano=2027"');
    expect(html()).toContain('href="/orc/receitas/r1"');
    expect(html()).toContain('Excluir 001/2026');
    const sem = html({ permissoes: { podeIncluir: false, podeAlterar: false, podeExcluir: false } });
    expect(sem).not.toContain('/orc/receitas/novo');
    expect(sem).not.toContain('Alterar 001/2026');
    expect(sem).not.toContain('Excluir');
    const fechado = html({ editavel: false });
    expect(fechado).not.toContain('/orc/receitas/novo');
    expect(fechado).not.toContain('Excluir');
  });

  it('sem receitas: texto próprio; aviso só com código conhecido', () => {
    const vazio = html({ confirmadas: [], previstas: [] });
    expect(vazio).toContain('<p>Nenhuma receita confirmada.</p>');
    expect(vazio).toContain('<p>Nenhuma receita prevista.</p>');
    expect(textoAvisoReceita('incluida')).toBe('Receita incluída.');
    expect(textoAvisoReceita('constructor')).toBeUndefined();
  });
});

describe('FormReceita', () => {
  it('inclusão: exercício oculto, Confirmado marcado e os 12 meses rotulados', () => {
    const h = renderToString(createElement(FormReceita, { ano: 2027, exercicioId: 'e1', salvar: acao }));
    expect(h).toMatch(/<input type="hidden" name="exercicioId" value="e1"\/>/);
    expect(h.match(/<input[^>]*value="Confirmado"[^>]*>/)?.[0]).toContain('checked=""');
    for (const m of ['Janeiro', 'Março', 'Dezembro']) expect(h).toContain(`>${m}</label>`);
    expect(h.match(/inputMode="decimal"/g)).toHaveLength(12);
  });

  it('alteração: id, versão, valores no formato da tela e Previsto marcado', () => {
    const h = renderToString(
      createElement(FormReceita, {
        ano: 2027,
        receita: { id: 'r1', tp: '001/2026', descricao: 'x', situacao: 'PREVISTO', meses: Array(12).fill('1.000,50'), versao: 3 },
        salvar: acao,
      }),
    );
    expect(h).toContain('name="id" value="r1"');
    expect(h).toContain('name="versao" value="3"');
    expect(h.match(/<input[^>]*value="Previsto"[^>]*>/)?.[0]).toContain('checked=""');
    expect(h).toContain('value="1.000,50"');
  });
});

describe('exercicioDoAno', () => {
  const exs = [{ ano: 2027 }, { ano: 2026 }];
  it('o do ano pedido; sem ano válido, o mais recente; sem exercícios, null', () => {
    expect(exercicioDoAno(exs, '2026')).toEqual({ ano: 2026 });
    expect(exercicioDoAno(exs, '2030')).toEqual({ ano: 2027 });
    expect(exercicioDoAno(exs, ['2026'])).toEqual({ ano: 2027 });
    expect(exercicioDoAno(exs, '2026abc')).toEqual({ ano: 2027 });
    expect(exercicioDoAno([], '2026')).toBeNull();
  });
});
