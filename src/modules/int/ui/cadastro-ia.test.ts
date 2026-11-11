import { describe, expect, it } from 'vitest';
import { formatarDolar, mensagemTeto, situacaoCaso } from './cadastro-ia';

describe('cadastro da IA: textos', () => {
  it('formata dólar em pt-BR a partir do texto canônico', () => {
    expect(formatarDolar('1234.5')).toBe('US$ 1.234,50');
    expect(formatarDolar('0.00')).toBe('US$ 0,00');
    expect(formatarDolar('9999999999.99')).toBe('US$ 9.999.999.999,99');
  });

  it('aviso de teto: global desliga tudo; do caso, só ele', () => {
    expect(mensagemTeto('11/2026', 'global')).toMatch(/todas as funções de IA estão desligadas até o próximo mês\. O resto do sistema segue normal\./);
    expect(mensagemTeto('11/2026', 'Sugestão de conta')).toMatch(/"Sugestão de conta" foi atingido em 11\/2026/);
  });

  it('situação do caso como a governança a vê', () => {
    const geral = { habilitada: true, tetoMensalUsd: '100.00' };
    expect(situacaoCaso({ ativo: false, tetoMensalUsd: '10.00' }, geral)).toBe('Desligado');
    expect(situacaoCaso({ ativo: true, tetoMensalUsd: '10.00' }, geral)).toBe('Ligado');
    expect(situacaoCaso({ ativo: true, tetoMensalUsd: '0.00' }, geral)).toMatch(/teto mensal do caso é zero/);
    expect(situacaoCaso({ ativo: true, tetoMensalUsd: '10.00' }, { habilitada: false, tetoMensalUsd: '100.00' })).toMatch(/configuração geral/);
    expect(situacaoCaso({ ativo: true, tetoMensalUsd: '10.00' }, { habilitada: true, tetoMensalUsd: '0.00' })).toMatch(/configuração geral/);
  });
});
