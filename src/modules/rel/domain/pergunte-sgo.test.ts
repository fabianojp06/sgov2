import { describe, expect, it } from 'vitest';
import { conferirClassificacao, CONSULTAS, mensagemPergunta, mesmoCc, mesmoTp, validarPergunta } from './pergunte-sgo';

describe('Pergunte ao SGO (US-104): pergunta e classificação', () => {
  it('pergunta: marcas e quebras saem; mínimo e máximo; bruto enorme recusado antes', () => {
    expect(validarPergunta(' Qual o\norçamento <<<de 2027>>>? ')).toEqual({ ok: true, valor: 'Qual o orçamento de 2027?' });
    expect(validarPergunta('oi')).toMatchObject({ ok: false, erros: [{ campo: 'pergunta' }] });
    expect(validarPergunta('<>'.repeat(5000))).toMatchObject({ ok: false });
    expect(validarPergunta(null)).toMatchObject({ ok: false });
  });

  it('classificação: consulta fora do catálogo vira NAO_SEI; ano fora da faixa vira o atual; CC e TP validados', () => {
    expect(conferirClassificacao({ consulta: 'APAGAR_TUDO', ano: 2027, cc: null, tp: null })).toEqual({ consulta: 'NAO_SEI', ano: 2027, cc: null, tp: null });
    // Ano nulo fica nulo (o exercício que a tela abre); ano dito é mantido (sem exercício, a resposta diz).
    expect(conferirClassificacao({ consulta: 'TETO_ADM_CENTRAL', ano: null, cc: null, tp: null }).ano).toBeNull();
    expect(conferirClassificacao({ consulta: 'ORCAMENTO_ADM_CENTRAL', ano: 1999, cc: null, tp: null })).toMatchObject({ consulta: 'ORCAMENTO_ADM_CENTRAL', ano: 1999 });
    expect(conferirClassificacao({ consulta: 'ORCADO_CC', ano: null, cc: ' 4.3.2 ', tp: null })).toEqual({ consulta: 'ORCADO_CC', ano: null, cc: '4.3.2', tp: null });
    expect(conferirClassificacao({ consulta: 'ORCADO_CC', ano: null, cc: "4.3'; DROP", tp: null }).consulta).toBe('NAO_SEI');
    expect(conferirClassificacao({ consulta: 'VALOR_GLOBAL_TP', ano: null, cc: null, tp: null }).consulta).toBe('NAO_SEI');
    // Parte 2: realizado e saldo do TP também exigem o TP.
    expect(conferirClassificacao({ consulta: 'REALIZADO_TP', ano: 2027, cc: null, tp: null }).consulta).toBe('NAO_SEI');
    expect(conferirClassificacao({ consulta: 'SALDO_TP', ano: null, cc: null, tp: ' TP-3 ' })).toEqual({ consulta: 'SALDO_TP', ano: null, cc: null, tp: 'TP-3' });
    expect(conferirClassificacao({ consulta: 'VALOR_GLOBAL_TP', ano: null, cc: null, tp: 'TP-001/2027' })).toMatchObject({ consulta: 'VALOR_GLOBAL_TP', tp: 'TP-001/2027' });
  });

  it('TP sem diferença de maiúsculas, hífen ou espaço; a mensagem leva o catálogo e a pergunta entre marcas, sem dados', () => {
    expect(mesmoTp('tp 001/2027', 'TP-001/2027')).toBe(true);
    expect(mesmoTp('TP-002/2027', 'TP-001/2027')).toBe(false);
    expect(mesmoTp('TP-3', 'tp 03')).toBe(true);
    expect(mesmoTp('TP-3', '3')).toBe(true);
    expect(mesmoTp('TP-3', '33')).toBe(false);
    expect(mesmoCc('4.1.1.1.001', '4.1.1.1.1')).toBe(true);
    expect(mesmoCc('4.3.2', '4.3.20')).toBe(false);
    const m = mensagemPergunta('Qual o teto?', 2026);
    for (const c of CONSULTAS) expect(m).toContain(`- ${c}:`);
    expect(m).toContain('Pergunta: <<<Qual o teto?>>>');
    expect(m).toContain('Ano atual: 2026.');
  });
});
