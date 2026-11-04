import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Competencia, Dinheiro, ok, Percentual } from '@/shared/kernel';
import { ehCaminhoInterno } from './domain/navegacao';
import { ContextoErros } from './ui/formulario';
import { aplicarAria, errosDoCampo, idErroDoCampo, type ElementoAria } from './ui/formulario-logica';
import { expansaoInicial, lerExpansaoSalva, visiveis } from './ui/grade-logica';
import * as ger from '@/modules/ger';
import {
  CELULA_INVALIDA,
  celulaCompetencia,
  celulaData,
  celulaDataSemHora,
  celulaDinheiro,
  celulaPercentual,
  ErroDoCampo,
  exportarXlsxFalso,
  formatarCelula,
  Formulario,
  LegendaComErro,
  GradeArvore,
  LIMITE_EXPORTACAO_SINCRONA,
  type ColunaGrade,
  type NoGrade,
  type PlanilhaExportacao,
  type PropsGradeArvore,
} from '@/modules/ger';
import { exportarCsv, exportarXlsx } from '@/modules/ger/servidor';

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
    for (const nome of ['x'.repeat(32), '', 'Receitas/2027', "'Aspas"]) {
      const r = await exportarXlsx([aba(nome, 1)]);
      expect(r.ok, nome).toBe(false);
      if (!r.ok) expect(r.erros).toEqual([expect.objectContaining({ campo: 'planilhas.0.nome' })]);
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

  it('#229: LegendaComErro renderiza a legenda; sem erro, nenhum id de erro no HTML', () => {
    const campos = createElement('fieldset', { name: 'forma' }, createElement(LegendaComErro, { campo: 'forma', children: 'Forma' }), createElement('input', { type: 'radio', name: 'forma', value: 'a' }));
    const html = renderToString(createElement(Formulario, { acao: async () => ok(null), children: campos }));
    expect(html).toMatch(/<legend>Forma<\/legend>/);
    expect(html).not.toContain('erro-forma');
    // Com erro: a mensagem dentro da legenda, separada do texto.
    const comErro = renderToString(
      createElement(ContextoErros.Provider, { value: [{ campo: 'forma', mensagem: 'Escolha uma.' }] }, createElement(LegendaComErro, { campo: 'forma', children: 'Forma' })),
    );
    expect(comErro).toMatch(/<legend>Forma.*<span id="erro-forma" data-campo="forma">Escolha uma\.<\/span><\/legend>/);
  });
});

describe('API pública do ger (C3)', () => {
  it('exporta componentes, validação da exportação e falsos pelo index.ts; o gerador pelo servidor.ts', () => {
    expect(typeof ger.GradeArvore).toBe('function');
    expect(typeof ger.Formulario).toBe('function');
    expect(typeof ger.ErroDoCampo).toBe('function');
    expect(typeof ger.LegendaComErro).toBe('function');
    // O gerador do .xlsx sai só pelo servidor.ts (o ExcelJS fora do navegador); o index.ts tem a validação.
    expect('exportarXlsx' in ger).toBe(false);
    expect(typeof ger.validarPlanilhas).toBe('function');
    expect(typeof exportarXlsx).toBe('function');
    expect('exportarCsv' in ger).toBe(false);
    expect(typeof exportarCsv).toBe('function');
    expect(typeof ger.exportarCsvFalso).toBe('function');
    expect(typeof ger.exportarXlsxFalso).toBe('function');
    // Filtros da Tree Grid (US-021 parte 3): props opcionais filtros e escopoSessao.
    expect(typeof ger.aplicarFiltros).toBe('function');
    expect(typeof ger.validarValoresFiltro).toBe('function');
    expect(typeof ger.lerFiltrosSalvos).toBe('function');
    const props: PropsGradeArvore = { idGrade: 'g', nos: [], colunas: [], filtros: [{ tipo: 'texto', id: 'b', rotulo: 'Buscar', campos: [] }], escopoSessao: 'h' };
    expect(props.filtros).toHaveLength(1);
    expect(typeof ger.LIMITE_EXPORTACAO_SINCRONA).toBe('number');
  });
});

describe('exportarXlsx: entradas inválidas', () => {
  it('recusa lista vazia', async () => {
    const r = await exportarXlsx([]);
    expect(r).toEqual({ ok: false, erros: [expect.objectContaining({ campo: 'planilhas' })] });
  });

  it('recusa abas repetidas sem diferenciar maiúsculas, apontando a segunda', async () => {
    const r = await exportarXlsx([aba('Receitas', 1), aba('RECEITAS', 1)]);
    expect(r).toEqual({ ok: false, erros: [expect.objectContaining({ campo: 'planilhas.1.nome' })] });
  });

  it('recusa linha sem um valor por coluna', async () => {
    const p: PlanilhaExportacao = { nome: 'A', colunas: [{ titulo: 'x', tipo: 'texto' }], linhas: [['a', 'b']] };
    const r = await exportarXlsx([p]);
    expect(r).toEqual({ ok: false, erros: [expect.objectContaining({ campo: 'planilhas.0.linhas' })] });
  });
});

describe('formatarCelula: valores fora do formato', () => {
  it.each([
    ['dinheiro', '1.234,50'],
    ['dinheiro', 'abc'],
    ['percentual', 'x%'],
    ['competencia', 'Junho/27'],
    ['data', '2027-13-45'],
    ['data', '2027-02-30'],
    ['data', '05/03/2027'],
  ] as const)('%s %j vira CELULA_INVALIDA, sem lançar', (tipo, valor) => {
    expect(formatarCelula(tipo, valor)).toBe(CELULA_INVALIDA);
  });

  it('dinheiro negativo e com mais de 2 casas (Half-Even do kernel)', () => {
    expect(formatarCelula('dinheiro', '-10.5')).toBe('-R$ 10,50');
    expect(formatarCelula('dinheiro', '0.125')).toBe('R$ 0,12');
  });

  it('data com horário ISO usa só a data', () => {
    expect(formatarCelula('data', '2027-03-05T10:00:00Z')).toBe('05/03/2027');
  });
});

describe('serializadores de célula', () => {
  it('produzem o formato que formatarCelula espera', () => {
    expect(formatarCelula('dinheiro', celulaDinheiro(Dinheiro.de('1234.5')))).toBe('R$ 1.234,50');
    expect(formatarCelula('percentual', celulaPercentual(Percentual.dePontos('51')))).toBe('51,00%');
    expect(formatarCelula('competencia', celulaCompetencia(Competencia.de(2027, 6)))).toBe('Jun/27');
    expect(formatarCelula('data', celulaDataSemHora(new Date(Date.UTC(2027, 2, 5))))).toBe('05/03/2027');
  });

  it('celulaData usa o dia de Brasília: 23h30 de 05/03 não vira 06/03', () => {
    expect(celulaData(new Date('2027-03-05T23:30:00-03:00'))).toBe('2027-03-05');
    expect(celulaData(new Date('2027-03-05T00:30:00-03:00'))).toBe('2027-03-05');
  });
});

describe('lógica da grade', () => {
  const arvore: NoGrade[] = [
    { id: 'a', linha: {}, filhos: [{ id: 'a1', linha: {}, filhos: [{ id: 'a11', linha: {} }] }] },
    { id: 'b', linha: {} },
  ];

  it('expandidos como lista de ids abre só esses', () => {
    const abertos = expansaoInicial(arvore, ['a']);
    expect(visiveis(arvore, abertos).map((l) => `${l.no.id}:${l.nivel}`)).toEqual(['a:1', 'a1:2', 'b:1']);
  });

  it('"todos" abre todos os nós com filhos', () => {
    expect([...expansaoInicial(arvore, 'todos')].sort()).toEqual(['a', 'a1']);
  });

  it('lê a expansão salva na sessão e ignora texto corrompido', () => {
    expect(lerExpansaoSalva('["a","a1"]')).toEqual(new Set(['a', 'a1']));
    for (const texto of [null, '', '{', '{"a":1}', '[1,2]']) expect(lerExpansaoSalva(texto)).toBeUndefined();
  });

  it('href externo, de protocolo relativo ou javascript: não vira link', () => {
    const colunas: ColunaGrade[] = [{ campo: 'conta', titulo: 'Conta', tipo: 'texto' }];
    for (const href of ['https://fora.exemplo', '//fora.exemplo', 'javascript:alert(1)', '/\\fora.exemplo']) {
      const html = renderToString(
        createElement(GradeArvore, { idGrade: 'x', colunas, nos: [{ id: '1', linha: { conta: 'c' }, href }] }),
      );
      expect(html, href).not.toContain('<a ');
    }
  });

  it('o genérico liga o campo da coluna às chaves da linha', () => {
    const coluna: ColunaGrade<'conta'> = { campo: 'conta', titulo: 'Conta', tipo: 'texto' };
    // @ts-expect-error "contaa" não é chave da linha
    const errada: ColunaGrade<'conta'> = { campo: 'contaa', titulo: 'Conta', tipo: 'texto' };
    expect([coluna.campo, errada.campo]).toEqual(['conta', 'contaa']);
  });
});

describe('lógica do formulário', () => {
  it('ErroDoCampo mostra só as mensagens do próprio campo, com id para aria-describedby', () => {
    const erros = [
      { campo: 'nome', mensagem: 'Obrigatório.' },
      { campo: '', mensagem: 'Erro geral.' },
      { campo: 'nome', mensagem: 'Curto demais.' },
    ];
    expect(errosDoCampo(erros, 'nome')).toEqual(['Obrigatório.', 'Curto demais.']);
    expect(errosDoCampo(erros, 'email')).toEqual([]);
    expect(idErroDoCampo('nome')).toBe('erro-nome');
  });

  // Elemento falso do DOM: o efeito do Formulario sem jsdom.
  const el = (tagName: string, attrs: Record<string, string> = {}): ElementoAria & { attrs: Record<string, string> } => ({
    tagName,
    attrs: { ...attrs },
    getAttribute(n) {
      return n in this.attrs ? this.attrs[n]! : null;
    },
    setAttribute(n, v) {
      this.attrs[n] = v;
    },
    removeAttribute(n) {
      delete this.attrs[n];
    },
  });

  it('#229: com erro, o campo recebe erro-<campo> e aria-invalid; sem erro, sai só o que o Formulario pôs', () => {
    const ano = el('INPUT', { name: 'ano', 'aria-describedby': 'dica-ano' });
    const nome = el('INPUT', { name: 'nome', 'aria-invalid': 'true' }); // posto pela tela
    aplicarAria([ano, nome], [{ campo: 'ano', mensagem: 'Obrigatório.' }]);
    expect(ano.attrs).toMatchObject({ 'aria-describedby': 'dica-ano erro-ano', 'aria-invalid': 'true' });
    expect(nome.attrs['aria-invalid']).toBe('true');
    aplicarAria([ano, nome], [{ campo: 'ano', mensagem: 'Obrigatório.' }]); // sem repetir o id
    expect(ano.attrs['aria-describedby']).toBe('dica-ano erro-ano');
    aplicarAria([ano, nome], []);
    expect(ano.attrs).toEqual({ name: 'ano', 'aria-describedby': 'dica-ano' });
    // O aria-invalid da tela não é do Formulario: fica.
    expect(nome.attrs['aria-invalid']).toBe('true');
  });

  it('#229: fieldset sem name descrito pela tela perde o erro-<x> sem erro e o mantém com erro', () => {
    const fs = el('FIELDSET', { 'aria-describedby': 'erro-forma' });
    aplicarAria([fs], []);
    expect(fs.attrs['aria-describedby']).toBeUndefined();
    const fs2 = el('FIELDSET', { 'aria-describedby': 'regra erro-forma' });
    aplicarAria([fs2], [{ campo: 'forma', mensagem: 'Escolha uma.' }]);
    expect(fs2.attrs['aria-describedby']).toBe('regra erro-forma');
    // O de outro campo com prefixo parecido (erro-anos × ano) segue a regra do próprio campo.
    const x = el('INPUT', { name: 'ano', 'aria-describedby': 'erro-anos' });
    aplicarAria([x], [{ campo: 'anos', mensagem: 'x' }]);
    expect(x.attrs['aria-describedby']).toBe('erro-anos');
  });

  it('#229: radio, checkbox e hidden não recebem o aria do erro; o fieldset com name do grupo, sim; erro geral não marca nada', () => {
    const r1 = el('INPUT', { name: 'forma', type: 'radio' });
    const cb = el('INPUT', { name: 'perfis', type: 'checkbox' });
    const oculto = el('INPUT', { name: 'versao', type: 'hidden' });
    const grupo = el('FIELDSET', { name: 'forma' });
    const erros = [
      { campo: 'forma', mensagem: 'Escolha uma.' },
      { campo: 'perfis', mensagem: 'Marque um.' },
      { campo: 'versao', mensagem: 'x' },
      { campo: '', mensagem: 'Erro geral.' },
    ];
    aplicarAria([r1, cb, oculto, grupo], erros);
    for (const e of [r1, cb, oculto]) expect(e.attrs['aria-invalid'] ?? e.attrs['aria-describedby']).toBeUndefined();
    expect(grupo.attrs).toMatchObject({ 'aria-describedby': 'erro-forma', 'aria-invalid': 'true' });
    const geral = el('INPUT', { name: '' });
    aplicarAria([geral], erros);
    expect(geral.attrs).toEqual({ name: '' });
  });

  it('só caminho interno serve de destino', () => {
    expect(ehCaminhoInterno('/orc/contas')).toBe(true);
    for (const d of ['https://fora.exemplo', '//fora.exemplo', '/\\fora', 'javascript:x', 'orc', '/\t/evil.com', '/\n/evil.com', '/a\\b', '/\r/x']) {
      expect(ehCaminhoInterno(d), d).toBe(false);
    }
  });
});
