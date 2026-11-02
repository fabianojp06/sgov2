import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lerPlanilhaSegura } from '@/modules/ger/servidor';
import { encontrarMarcaVedada } from '@/shared/config';
import { sanearDescricao } from '../application/saneamento';
import { COLUNAS_PLANO_CONTAS, validarPlanoContas, type LinhaLida } from '../domain/plano-contas';
import oficial from './dados/plano-contas-oficial.json';

// O plano de contas oficial transcrito (plano do P4, Task 4a, Step 2). Fica fora de domain/,
// que não importa infrastructure/.
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

  it('a planilha de especificacao/, lida pela aba "Plano de Contas", bate com o JSON depois do saneamento', async () => {
    const pasta = join(process.cwd(), 'especificacao');
    const nome = readdirSync(pasta).find((n) => /^Plano_de_Contas_5_Niveis_.*\.xlsx$/.test(n));
    if (!nome) throw new Error('planilha oficial não encontrada em especificacao/');
    const r = await lerPlanilhaSegura(
      { nome, conteudo: new Uint8Array(readFileSync(join(pasta, nome))) },
      { aba: 'Plano de Contas', colunas: COLUNAS_PLANO_CONTAS, linhaCabecalhoMax: 1 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.errosCelula).toEqual([]);
    const saneadas = r.valor.linhas.map((l) => ({
      numero: l.numero,
      celulas: { ...l.celulas, Descrição: l.celulas['Descrição'] === null ? null : sanearDescricao(l.celulas['Descrição']!).texto },
    }));
    expect(saneadas).toEqual(oficial);
    const v = validarPlanoContas(r.valor.linhas, sanearDescricao);
    expect(v.ok && v.avisos).toEqual([{ linha: 166, coluna: 'Descrição', mensagem: 'O nome da instituição foi retirado da descrição.' }]);
  });
});
