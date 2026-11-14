import { describe, expect, it } from 'vitest';
import { conferirRoteiro, ESQUEMA_ROTEIRO, graficosPossiveis, MAXIMO_SLIDES, MAXIMO_TEMA, mensagemApresentacao, validarTema } from './apresentacao';
import type { DadosRelatorio } from './relatorio-executivo';

const ADM = { ano: 2027, situacao: 'Oficializado', orcamentoAno: '1000.00', pessoal: '600.00', percentualPessoal: '60.00', empregadosDezembro: 4, tetoEfetivo: '1200.00', usoDoTeto: '83.33', resultadoAno: '0.00', saldo: '200.00' };
const dados = (extra: Partial<DadosRelatorio> = {}): DadosRelatorio => ({ mes: '2027-05', admCentral: ADM, tps: [{ numero: 'TP-1', oficial: true, valorGlobal: '50.00', execucao: '0.00' }], tpsOmitidos: 0, ...extra });

describe('roteiro de apresentação (US-105)', () => {
  it('tema: tira as marcas, mínimo e máximo; texto bruto enorme é recusado antes', () => {
    expect(validarTema('  Orçamento <<<2027>>> ')).toEqual({ ok: true, valor: 'Orçamento 2027' });
    expect(validarTema('<<<>>>abc')).toMatchObject({ ok: false, erros: [{ campo: 'tema' }] });
    expect(validarTema('x'.repeat(MAXIMO_TEMA + 1))).toMatchObject({ ok: false });
    expect(validarTema('<>'.repeat(MAXIMO_TEMA * 4))).toMatchObject({ ok: false });
    expect(validarTema(42)).toMatchObject({ ok: false });
  });

  it('gráficos só os que os dados permitem; gráfico impossível vira NENHUM; limites aplicados', () => {
    expect(graficosPossiveis(dados())).toEqual(['NENHUM', 'ORCAMENTO_TETO', 'VALOR_GLOBAL_TPS']);
    expect(graficosPossiveis(dados({ admCentral: null, tps: null }))).toEqual(['NENHUM']);
    const r = conferirRoteiro(
      {
        slides: [
          { titulo: ' Visão ', topicos: ['a', ' ', 'b', 'c', 'd', 'e', 'f'], grafico: 'VALOR_GLOBAL_TPS', notas: 'n' },
          { titulo: 'Teto', topicos: [], grafico: 'ORCAMENTO_TETO', notas: '' },
          { titulo: ' ', topicos: ['x'], grafico: 'NENHUM', notas: '' },
          ...Array.from({ length: 12 }, () => ({ titulo: 'Extra', topicos: [], grafico: 'INVENTADO', notas: '' })),
        ],
      },
      dados({ admCentral: null }),
    );
    expect(r.slides[0]).toEqual({ titulo: 'Visão', topicos: ['a', 'b', 'c', 'd', 'e'], grafico: 'VALOR_GLOBAL_TPS', notas: 'n' });
    expect(r.slides[1]!.grafico).toBe('NENHUM');
    expect(r.slides).toHaveLength(MAXIMO_SLIDES);
    expect(r.slides.every((s) => s.titulo.length > 0 && s.grafico !== ('INVENTADO' as string))).toBe(true);
  });

  it('roteiro do navegador validado de forma estrita; a mensagem cerca o tema e lista os gráficos', () => {
    const bom = { slides: [{ titulo: 'T', topicos: ['a'], grafico: 'NENHUM', notas: '' }] };
    expect(ESQUEMA_ROTEIRO.safeParse(bom).success).toBe(true);
    expect(ESQUEMA_ROTEIRO.safeParse({ slides: [] }).success).toBe(false);
    expect(ESQUEMA_ROTEIRO.safeParse({ slides: [{ ...bom.slides[0], grafico: 'X' }] }).success).toBe(false);
    expect(ESQUEMA_ROTEIRO.safeParse({ slides: [{ ...bom.slides[0], extra: 1 }] }).success).toBe(false);
    const m = mensagemApresentacao('Orçamento 2027', dados());
    expect(m).toContain('Tema pedido: <<<Orçamento 2027>>>');
    expect(m).toContain('NENHUM, ORCAMENTO_TETO, VALOR_GLOBAL_TPS');
  });
});
