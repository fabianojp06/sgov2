import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ok } from '@/shared/kernel';
import * as ger from '@/modules/ger';
import {
  ErroDoCampo,
  exportarXlsx,
  exportarXlsxFalso,
  formatarCelula,
  Formulario,
  GradeArvore,
  LIMITE_EXPORTACAO_SINCRONA,
  type ColunaGrade,
  type NoGrade,
  type PlanilhaExportacao,
  type PropsGradeArvore,
} from '@/modules/ger';

// Contrato C3 (plano do P3, Tarefa 2): componentes de tela do módulo ger.
const aba = (nome: string, linhas: number): PlanilhaExportacao => ({
  nome,
  colunas: [{ titulo: 'Conta', tipo: 'texto' }],
  linhas: Array.from({ length: linhas }, (_, i) => [`linha ${i}`]),
});

describe('exportarXlsx', () => {
  it('recusa mais de 5.000 linhas somando as abas', async () => {
    const r = await exportarXlsx([aba('A', 2501), aba('B', 2500)]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros).toEqual([expect.objectContaining({ campo: 'linhas' })]);
  });

  it('aceita exatamente o limite', async () => {
    const r = await exportarXlsx([aba('A', 2500), aba('B', 2500)]);
    expect(r.ok).toBe(true);
  });

  it('recusa nome de aba com mais de 31 caracteres, vazio ou com caractere proibido pelo Excel', async () => {
    for (const nome of ['x'.repeat(32), '', 'Receitas/2027']) {
      const r = await exportarXlsx([aba(nome, 1)]);
      expect(r.ok, nome).toBe(false);
      if (!r.ok) expect(r.erros).toEqual([expect.objectContaining({ campo: 'nome' })]);
    }
  });

  it('com uma aba válida devolve os bytes do arquivo', async () => {
    const r = await exportarXlsx([aba('Orçamento', 1)]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor).toBeInstanceOf(Uint8Array);
  });

  it('o falso registra as chamadas e devolve ok', async () => {
    const falso = exportarXlsxFalso();
    const planilhas = [aba('A', 1)];
    expect(await falso.exportar(planilhas)).toEqual(ok(new Uint8Array()));
    expect(falso.chamadas).toEqual([planilhas]);
  });

  it('o limite síncrono é o da RF_IMP_003', () => {
    expect(LIMITE_EXPORTACAO_SINCRONA).toBe(5000);
  });
});

describe('formatarCelula', () => {
  it('formata cada tipo pelo kernel, a partir de string', () => {
    expect(formatarCelula('dinheiro', '1234.5')).toBe('R$ 1.234,50');
    expect(formatarCelula('percentual', '51')).toBe('51,00%');
    expect(formatarCelula('competencia', 'jun/27')).toBe('Jun/27');
    expect(formatarCelula('data', '2027-03-05')).toBe('05/03/2027');
    expect(formatarCelula('texto', 'Pessoal')).toBe('Pessoal');
    expect(formatarCelula('dinheiro', null)).toBe('');
  });
});

describe('GradeArvore', () => {
  const colunas: ColunaGrade[] = [
    { campo: 'conta', titulo: 'Conta', tipo: 'texto' },
    { campo: 'orcado', titulo: 'Orçado', tipo: 'dinheiro' },
  ];
  const nos: NoGrade[] = [
    {
      id: '1',
      linha: { conta: '1 Pessoal', orcado: '1500.00' },
      href: '/orc/contas/1',
      filhos: [{ id: '1.1', linha: { conta: '1.1 Salários', orcado: '1000.00' } }],
    },
  ];

  it('renderiza a partir de props que sobreviveram à serialização (Server Component → cliente)', () => {
    const props: PropsGradeArvore = { idGrade: 'teste', nos, colunas, expandidos: 'todos' };
    const html = renderToString(createElement(GradeArvore, JSON.parse(JSON.stringify(props)) as PropsGradeArvore));
    expect(html).toContain('role="treegrid"');
    expect(html).toContain('aria-level="1"');
    expect(html).toContain('aria-level="2"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('R$ 1.500,00');
    expect(html).toContain('href="/orc/contas/1"');
  });

  it('com expandidos "nenhum" mostra só a raiz', () => {
    const html = renderToString(createElement(GradeArvore, { idGrade: 'teste', nos, colunas, expandidos: 'nenhum' }));
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Salários');
  });

  it('sem nós mostra o texto de vazio', () => {
    const html = renderToString(createElement(GradeArvore, { idGrade: 'teste', nos: [], colunas, textoVazio: 'Nada aqui' }));
    expect(html).toContain('Nada aqui');
  });

  it('coluna sem tipo não compila', () => {
    // @ts-expect-error o tipo da coluna é obrigatório no contrato C3
    const coluna: ColunaGrade = { campo: 'conta', titulo: 'Conta' };
    expect(coluna.campo).toBe('conta');
  });
});

describe('Formulario', () => {
  it('renderiza os campos, o ErroDoCampo vazio e o botão com o texto pedido', () => {
    const acao = async () => ok({ id: '1' });
    const campos = createElement(
      'label',
      null,
      'Nome',
      createElement('input', { name: 'nome' }),
      createElement(ErroDoCampo, { campo: 'nome' }),
    );
    const html = renderToString(createElement(Formulario<{ id: string }>, { acao, textoEnviar: 'Gravar', children: campos }));
    expect(html).toContain('name="nome"');
    expect(html).toContain('>Gravar</button>');
    expect(html).not.toContain('role="alert"');
  });
});

describe('API pública do ger (C3)', () => {
  it('exporta componentes, exportação e falsos pelo index.ts', () => {
    expect(typeof ger.GradeArvore).toBe('function');
    expect(typeof ger.Formulario).toBe('function');
    expect(typeof ger.ErroDoCampo).toBe('function');
    expect(typeof ger.exportarXlsx).toBe('function');
    expect(typeof ger.exportarXlsxFalso).toBe('function');
    expect(typeof ger.LIMITE_EXPORTACAO_SINCRONA).toBe('number');
  });
});
