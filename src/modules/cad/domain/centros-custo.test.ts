import { describe, expect, it } from 'vitest';
import { validarCentrosCusto } from './centros-custo';
import type { LinhaLida } from './plano-contas';

// Validação dos centros de custo (plano do P4, Task 5, Step 1; R17).
const semSaneamento = (texto: string) => ({ texto, retirou: false });
type C = { cl: string; red: string; nivel: string; pai: string | null; tipo: 'Sintético' | 'Analítico'; aceita?: string; orig?: string | null; sug?: string };
const linhas = (...itens: C[]): LinhaLida[] =>
  itens.map((c, i) => ({
    numero: i + 5,
    celulas: {
      Classificação: c.cl,
      'Código reduzido': c.red,
      'Descrição (original)': c.orig === undefined ? `Original ${c.cl}` : c.orig,
      'Descrição sugerida': c.sug ?? `CC ${c.cl}`,
      Nível: c.nivel,
      'Classificação pai': c.pai,
      Tipo: c.tipo,
      'Aceita lançamento': c.aceita ?? (c.tipo === 'Analítico' ? 'S' : 'N'),
    },
  }));

// DIREX → diretoria 4.3 (gestão 4.3.0) → gerência 4.3.2 (gestão 4.3.2.10, setor 4.3.2.11); 4.4 analítico.
const base: C[] = [
  { cl: '4', red: '14.180', nivel: '1', pai: null, tipo: 'Sintético' },
  { cl: '4.3', red: '14.310', nivel: '2', pai: '4', tipo: 'Sintético' },
  { cl: '4.3.0', red: '14.500', nivel: '3', pai: '4.3', tipo: 'Analítico' },
  { cl: '4.3.2', red: '14.360', nivel: '3', pai: '4.3', tipo: 'Sintético' },
  { cl: '4.3.2.10', red: '14.520', nivel: '4', pai: '4.3.2', tipo: 'Analítico' },
  { cl: '4.3.2.11', red: '14.370', nivel: '4', pai: '4.3.2', tipo: 'Analítico' },
  { cl: '4.4', red: '14.450', nivel: '2', pai: '4', tipo: 'Analítico' },
];

function errosDe(...itens: C[]) {
  const r = validarCentrosCusto(linhas(...itens), semSaneamento);
  if (r.ok) throw new Error('era para reprovar');
  return r.erros;
}

describe('validarCentrosCusto', () => {
  it('a árvore base é válida: gestão pela R17, sem aviso; vale a descrição sugerida, a original em descricaoOriginal', () => {
    const r = validarCentrosCusto(linhas(...base), semSaneamento);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.centros.filter((c) => c.deGestao).map((c) => c.classificacao)).toEqual(['4.3.0', '4.3.2.10']);
    expect(r.avisos).toEqual([]);
    expect(r.centros[2]).toMatchObject({ descricao: 'CC 4.3.0', descricaoOriginal: 'Original 4.3.0', tipo: 'ANALITICO', nivel: 3 });
  });

  it.each([
    ['reduzido numérico virado número (14.18)', { red: '14.18' }, 'Código reduzido'],
    ['reduzido fora do formato', { red: '14180' }, 'Código reduzido'],
    ['"Aceita lançamento = S" num sintético', { aceita: 'S' }, 'Aceita lançamento'],
  ] as const)('%s → erro na linha', (_caso, mudar, coluna) => {
    const e = errosDe(...base.slice(0, 3), { ...base[3]!, ...mudar }, ...base.slice(4));
    expect(e).toContainEqual(expect.objectContaining({ linha: 8, coluna }));
  });

  it('analítico no nível 1 → erro', () => {
    expect(errosDe({ ...base[0]!, tipo: 'Analítico' }, ...base.slice(1))).toContainEqual({ linha: 5, coluna: 'Tipo', mensagem: 'O nível 1 não pode ser analítico.' });
  });

  it('pai inexistente e sintético sem filho → erro', () => {
    expect(errosDe(...base, { cl: '4.9.1', red: '14.999', nivel: '3', pai: '4.9', tipo: 'Analítico' })).toContainEqual(
      expect.objectContaining({ linha: 12, coluna: 'Classificação pai', mensagem: 'A classificação pai não existe na planilha.' }),
    );
    expect(errosDe(...base, { cl: '4.5', red: '14.998', nivel: '2', pai: '4', tipo: 'Sintético' })).toEqual([
      { linha: 12, coluna: 'Classificação', mensagem: 'O centro de custo sintético precisa ter pelo menos um abaixo.' },
    ]);
  });

  it('reduzido repetido → as duas linhas citadas', () => {
    expect(errosDe(...base, { cl: '4.3.2.12', red: '14.370', nivel: '4', pai: '4.3.2', tipo: 'Analítico' })).toEqual([
      { linha: 10, coluna: 'Código reduzido', mensagem: 'Código reduzido repetido na linha 12.' },
      { linha: 12, coluna: 'Código reduzido', mensagem: 'Código reduzido repetido na linha 10.' },
    ]);
  });

  it('avisos da R3: gerência sem .10 e diretoria sem .0 (sem bloquear)', () => {
    const semGestao = base.filter((c) => c.cl !== '4.3.2.10');
    const r1 = validarCentrosCusto(linhas(...semGestao), semSaneamento);
    expect(r1.ok && r1.avisos).toEqual([expect.objectContaining({ coluna: 'Classificação', mensagem: expect.stringContaining('4.3.2 tem 0') })]);
    // Diretoria sem o .0. Dois CCs de gestão no mesmo pai não existem: há um só sufixo .0 ou .10 por pai.
    const r2 = validarCentrosCusto(linhas(...base.filter((c) => c.cl !== '4.3.0')), semSaneamento);
    expect(r2.ok && r2.avisos).toEqual([expect.objectContaining({ mensagem: expect.stringContaining('A diretoria 4.3 tem 0') })]);
  });

  it('as mensagens não repetem o conteúdo da célula', () => {
    const e = errosDe(...base, { cl: 'abc;x', red: 'zz9', nivel: '7', pai: 'qq', tipo: 'Analítico', aceita: 'talvez' });
    expect(JSON.stringify(e)).not.toMatch(/abc|zz9|qq|talvez/);
  });
});
