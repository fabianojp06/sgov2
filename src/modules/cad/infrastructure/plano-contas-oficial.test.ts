import { describe, expect, it } from 'vitest';
import { encontrarMarcaVedada } from '@/shared/config';
import { sanearDescricao } from '../application/saneamento';
import { validarPlanoContas, type LinhaLida } from '../domain/plano-contas';
import oficial from './dados/plano-contas-oficial.json';

// O plano de contas oficial transcrito (plano do P4, Task 4a, Step 2). Fica fora de domain/,
// que não importa infrastructure/. A comparação com a planilha de especificacao/ é da Task 4c.
const semSaneamento = (texto: string) => ({ texto, retirou: false });

describe('plano de contas oficial', () => {
  it('o plano oficial: 174 contas, 12 sintéticas e 162 analíticas, sem aviso', () => {
    const r = validarPlanoContas(oficial as LinhaLida[], semSaneamento);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.contas).toHaveLength(174);
    expect(r.contas.filter((c) => c.tipo === 'SINTETICA')).toHaveLength(12);
    expect(r.contas.filter((c) => c.tipo === 'ANALITICA')).toHaveLength(162);
    expect(r.avisos).toEqual([]);
    expect(r.contas.find((c) => c.classificacao === '4.1.1.1.001')).toEqual({
      linha: 6,
      classificacao: '4.1.1.1.001',
      codigoReduzido: '900',
      descricao: 'Salários',
      nivel: 5,
      tipo: 'ANALITICA',
      classificacaoPai: '4.1.1.1',
    });
  });

  it('o JSON não tem a marca vedada e o saneamento não muda nada nele', () => {
    expect(encontrarMarcaVedada(JSON.stringify(oficial))).toEqual([]);
    const r = validarPlanoContas(oficial as LinhaLida[], sanearDescricao);
    expect(r.ok && r.avisos).toEqual([]);
  });
});
