import { describe, expect, it } from 'vitest';
import { CAMPO_IMPEDITIVO, impeditivos, separarImpeditivos } from './impeditivos';

describe('impeditivos de exclusão (US-023)', () => {
  it('um erro por vínculo com quantidade, na ordem, com o número em pt-BR', () => {
    expect(
      impeditivos([
        { descricao: 'Propostas ativas', quantidade: 2 },
        { descricao: 'Lançamentos', quantidade: 0 },
        { descricao: 'Linhas do orçamento', quantidade: 1234 },
      ]),
    ).toEqual([
      { campo: CAMPO_IMPEDITIVO, mensagem: 'Propostas ativas: 2' },
      { campo: CAMPO_IMPEDITIVO, mensagem: 'Linhas do orçamento: 1.234' },
    ]);
    expect(impeditivos([{ descricao: 'Nada', quantidade: 0 }])).toEqual([]);
  });

  it('separa os impeditivos dos outros erros', () => {
    const outro = { campo: 'versao', mensagem: 'Recarregue a tela.' };
    expect(separarImpeditivos([outro, ...impeditivos([{ descricao: 'Propostas', quantidade: 1 }])])).toEqual({
      impeditivos: ['Propostas: 1'],
      outros: [outro],
    });
  });
});
