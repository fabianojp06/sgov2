import { describe, expect, it } from 'vitest';
import { gerarPdfApresentacao } from './pdf-apresentacao';

describe('slides da apresentação em PDF (US-105)', () => {
  it('gera um PDF válido com capa, gráficos do sistema, tópicos longos e emoji', async () => {
    const bytes = await gerarPdfApresentacao(
      'Orçamento 2027 da Administração Central 🚀',
      {
        slides: [
          { titulo: 'Visão geral', topicos: ['Tópico '.repeat(60), 'Outro'], grafico: 'ORCAMENTO_TETO', notas: 'Notas '.repeat(100) },
          { titulo: 'TPs', topicos: [], grafico: 'VALOR_GLOBAL_TPS', notas: '' },
        ],
      },
      {
        mes: '2027-05',
        admCentral: { ano: 2027, situacao: 'Oficializado', orcamentoAno: '1000.00', pessoal: '600.00', percentualPessoal: '60.00', empregadosDezembro: 4, tetoEfetivo: '1200.00', usoDoTeto: '83.33', resultadoAno: '0.00', saldo: '200.00' },
        tps: Array.from({ length: 14 }, (_, i) => ({ numero: `TP-${i}`, oficial: i % 2 === 0, valorGlobal: i === 3 ? null : `${(i + 1) * 100}.00`, execucao: null })),
        tpsOmitidos: 0,
      },
      'gfin',
    );
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
