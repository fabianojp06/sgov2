import { describe, expect, it } from 'vitest';
import { conferirClassificacao, CONSULTAS, mensagemPergunta, mesmoTp, validarPergunta } from './pergunte-sgo';

describe('Pergunte ao SGO (US-104): pergunta e classificação', () => {
  it('pergunta: marcas e quebras saem; mínimo e máximo; bruto enorme recusado antes', () => {
    expect(validarPergunta(' Qual o\norçamento <<<de 2027>>>? ')).toEqual({ ok: true, valor: 'Qual o orçamento de 2027?' });
    expect(validarPergunta('oi')).toMatchObject({ ok: false, erros: [{ campo: 'pergunta' }] });
    expect(validarPergunta('<>'.repeat(5000))).toMatchObject({ ok: false });
    expect(validarPergunta(null)).toMatchObject({ ok: false });
  });

  it('classificação: consulta fora do catálogo vira NAO_SEI; ano fora da faixa vira o atual; CC e TP validados', () => {
    expect(conferirClassificacao({ consulta: 'APAGAR_TUDO', ano: 2027, cc: null, tp: null }, 2026)).toEqual({ consulta: 'NAO_SEI', ano: 2027, cc: null, tp: null });
    expect(conferirClassificacao({ consulta: 'ORCAMENTO_ADM_CENTRAL', ano: 1900, cc: null, tp: null }, 2026)).toMatchObject({ consulta: 'ORCAMENTO_ADM_CENTRAL', ano: 2026 });
    expect(conferirClassificacao({ consulta: 'ORCADO_CC', ano: null, cc: ' 4.3.2 ', tp: null }, 2026)).toEqual({ consulta: 'ORCADO_CC', ano: 2026, cc: '4.3.2', tp: null });
    expect(conferirClassificacao({ consulta: 'ORCADO_CC', ano: null, cc: "4.3'; DROP", tp: null }, 2026).consulta).toBe('NAO_SEI');
    expect(conferirClassificacao({ consulta: 'VALOR_GLOBAL_TP', ano: null, cc: null, tp: null }, 2026).consulta).toBe('NAO_SEI');
    expect(conferirClassificacao({ consulta: 'VALOR_GLOBAL_TP', ano: null, cc: null, tp: 'TP-001/2027' }, 2026)).toMatchObject({ consulta: 'VALOR_GLOBAL_TP', tp: 'TP-001/2027' });
  });

  it('TP sem diferença de maiúsculas, hífen ou espaço; a mensagem leva o catálogo e a pergunta entre marcas, sem dados', () => {
    expect(mesmoTp('tp 001/2027', 'TP-001/2027')).toBe(true);
    expect(mesmoTp('TP-002/2027', 'TP-001/2027')).toBe(false);
    const m = mensagemPergunta('Qual o teto?', 2026);
    for (const c of CONSULTAS) expect(m).toContain(`- ${c}:`);
    expect(m).toContain('Pergunta: <<<Qual o teto?>>>');
    expect(m).toContain('Ano atual: 2026.');
  });
});
