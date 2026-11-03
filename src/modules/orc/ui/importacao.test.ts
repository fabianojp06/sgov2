import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormImportacao, separarErros } from './form-importacao';

// Tela de importação (US-121; plano do P6, Task 4b).
describe('FormImportacao', () => {
  it('arquivo .xlsx com o rótulo do layout, exercício oculto e o botão Importar', () => {
    const h = renderToString(createElement(FormImportacao, { exercicioId: 'e1', importar: async () => ({ ok: true as const, valor: { mensagem: '', porCc: [] } }) }));
    expect(h).toContain('<label for="importacao-arquivo">Planilha (layout ADMC-ORC v1.0)</label>');
    const arquivo = h.match(/<input id="importacao-arquivo"[^>]*>/)?.[0] ?? '';
    for (const atributo of ['type="file"', 'accept=".xlsx"', 'required=""', 'name="arquivo"']) expect(arquivo).toContain(atributo);
    expect(h).toContain('name="exercicioId" value="e1"');
    expect(h).toContain('role="status"');
  });
});

describe('separarErros', () => {
  it('erros gerais e por linha (aba, linha, coluna), inclusive coluna com ponto no nome', () => {
    const r = separarErros([
      { campo: '_', mensagem: 'A planilha tem erros. Nada foi importado.' },
      { campo: 'linhas.Pessoal.25.Cargo', mensagem: 'Cargo obrigatório.' },
      { campo: 'linhas.Pacotes base zero.7.Atividade / justificativa (mín. 10 caracteres)', mensagem: 'Justificativa com menos de 10 caracteres.' },
      { campo: 'linhas.Receitas.9._', mensagem: 'x' },
      { campo: 'arquivo', mensagem: 'Arquivo maior que 1 MB.' },
    ]);
    expect(r.gerais).toEqual(['A planilha tem erros. Nada foi importado.', 'Arquivo maior que 1 MB.']);
    expect(r.porLinha).toEqual([
      { aba: 'Pessoal', linha: 25, coluna: 'Cargo', mensagem: 'Cargo obrigatório.' },
      { aba: 'Pacotes base zero', linha: 7, coluna: 'Atividade / justificativa (mín. 10 caracteres)', mensagem: 'Justificativa com menos de 10 caracteres.' },
      { aba: 'Receitas', linha: 9, coluna: '', mensagem: 'x' },
    ]);
  });
});
