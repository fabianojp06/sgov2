import { describe, expect, it } from 'vitest';
import { validarPlanoContas, type LinhaLida } from './plano-contas';

// Validação do plano de contas (plano do P4, Task 4a, Step 2; spec §6.1).
const semSaneamento = (texto: string) => ({ texto, retirou: false });

type Celulas = { nivel: string | null; classificacao: string; pai: string | null; descricao?: string; tipo: string; reduzido?: string | null };
const linhas = (...itens: Celulas[]): LinhaLida[] =>
  itens.map((c, i) => ({
    numero: i + 2,
    celulas: {
      Nível: c.nivel,
      Classificação: c.classificacao,
      'Conta Superior': c.pai,
      Descrição: c.descricao ?? `Conta ${c.classificacao}`,
      Tipo: c.tipo,
      'Conta Reduzida': c.reduzido ?? null,
    },
  }));

// Uma árvore mínima válida: 4 → 4.1 → 4.1.1 → 4.1.1.1 → 4.1.1.1.001.
const base: Celulas[] = [
  { nivel: '1', classificacao: '4', pai: null, tipo: 'S' },
  { nivel: '2', classificacao: '4.1', pai: '4', tipo: 'S' },
  { nivel: '3', classificacao: '4.1.1', pai: '4.1', tipo: 'S' },
  { nivel: '4', classificacao: '4.1.1.1', pai: '4.1.1', tipo: 'S' },
  { nivel: '5', classificacao: '4.1.1.1.001', pai: '4.1.1.1', tipo: 'A', reduzido: '900' },
];

function errosDe(...itens: Celulas[]) {
  const r = validarPlanoContas(linhas(...itens), semSaneamento);
  if (r.ok) throw new Error('era para reprovar');
  return r.erros;
}

describe('validarPlanoContas', () => {
  it('árvore mínima válida', () => {
    expect(validarPlanoContas(linhas(...base), semSaneamento).ok).toBe(true);
  });

  it('nível 6 → erro no Nível', () => {
    expect(errosDe(...base, { nivel: '6', classificacao: '4.1.1.1.001.1', pai: '4.1.1.1.001', tipo: 'A', reduzido: '1' })).toContainEqual(
      { linha: 7, coluna: 'Nível', mensagem: 'O nível deve ser de 1 a 5.' },
    );
  });

  it('segmentos diferentes do nível → erro na Classificação', () => {
    const e = errosDe(...base, { nivel: '5', classificacao: '4.1.1.1', pai: '4.1.1.1', tipo: 'A', reduzido: '1' });
    expect(e).toContainEqual({ linha: 7, coluna: 'Classificação', mensagem: 'A classificação deve ter tantos segmentos quanto o nível.' });
  });

  it('pai inexistente → erro na Conta Superior', () => {
    expect(errosDe(...base, { nivel: '5', classificacao: '4.1.1.2.001', pai: '4.1.1.2', tipo: 'A', reduzido: '1' })).toContainEqual({
      linha: 7,
      coluna: 'Conta Superior',
      mensagem: 'A conta superior não existe na planilha.',
    });
  });

  it('pai de nível errado → erro na Conta Superior', () => {
    expect(errosDe(...base, { nivel: '5', classificacao: '4.1.1.1.002', pai: '4.1.1', tipo: 'A', reduzido: '1' })).toContainEqual({
      linha: 7,
      coluna: 'Conta Superior',
      mensagem: 'A conta superior deve ter o nível imediatamente acima.',
    });
  });

  it('analítica fora do nível 5 → erro no Tipo', () => {
    const e = errosDe(...base.slice(0, 4), { nivel: '4', classificacao: '4.1.1.2', pai: '4.1.1', tipo: 'A', reduzido: '1' }, base[4]!);
    expect(e).toContainEqual({ linha: 6, coluna: 'Tipo', mensagem: 'Só as contas de nível 5 são analíticas, e todas elas são.' });
  });

  it('analítica sem reduzido → erro na Conta Reduzida', () => {
    expect(errosDe(...base.slice(0, 4), { ...base[4]!, reduzido: null })).toContainEqual({
      linha: 6,
      coluna: 'Conta Reduzida',
      mensagem: 'A conta analítica precisa da conta reduzida.',
    });
  });

  it('reduzido repetido → as duas linhas citadas', () => {
    const e = errosDe(...base, { nivel: '5', classificacao: '4.1.1.1.002', pai: '4.1.1.1', tipo: 'A', reduzido: '900' });
    expect(e).toEqual([
      { linha: 6, coluna: 'Conta Reduzida', mensagem: 'Conta reduzida repetida na linha 7.' },
      { linha: 7, coluna: 'Conta Reduzida', mensagem: 'Conta reduzida repetida na linha 6.' },
    ]);
  });

  it('classificação repetida → as duas linhas citadas', () => {
    const e = errosDe(...base, { ...base[4]!, reduzido: '901' });
    expect(e).toEqual([
      { linha: 6, coluna: 'Classificação', mensagem: 'Classificação repetida na linha 7.' },
      { linha: 7, coluna: 'Classificação', mensagem: 'Classificação repetida na linha 6.' },
    ]);
  });

  it('sintética sem filho → erro', () => {
    expect(errosDe(...base, { nivel: '4', classificacao: '4.1.1.9', pai: '4.1.1', tipo: 'S' })).toEqual([
      { linha: 7, coluna: 'Classificação', mensagem: 'A conta sintética precisa ter pelo menos uma conta abaixo.' },
    ]);
  });

  it('planilha vazia → erro', () => {
    expect(validarPlanoContas([], semSaneamento)).toEqual({ ok: false, erros: [{ linha: 0, mensagem: 'A planilha não tem contas.' }] });
  });

  it('descrição saneada vira aviso, sem citar o texto retirado', () => {
    const sanear = (t: string) => (t.includes('XYZ') ? { texto: t.replace(' XYZ', ''), retirou: true } : { texto: t, retirou: false });
    const r = validarPlanoContas(linhas(...base.slice(0, 4), { ...base[4]!, descricao: 'Salários XYZ' }), sanear);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.contas[4]!.descricao).toBe('Salários');
    expect(r.avisos).toEqual([{ linha: 6, coluna: 'Descrição', mensagem: 'O nome da instituição foi retirado da descrição.' }]);
  });

  it('as mensagens não repetem o conteúdo da célula', () => {
    const e = errosDe(...base, { nivel: '9', classificacao: 'abc;DROP', pai: 'zzz', tipo: 'Q', reduzido: 'x1' });
    expect(JSON.stringify(e)).not.toMatch(/abc|DROP|zzz|x1/);
  });

  it.each([
    ['prefixo do pai', { nivel: '5', classificacao: '4.1.1.2.001', pai: '4.1.1.1', tipo: 'A', reduzido: '1' }, 'Conta Superior', 'A classificação deve começar pela da conta superior.'],
    ['sintética com reduzido', { nivel: '4', classificacao: '4.1.1.2', pai: '4.1.1', tipo: 'S', reduzido: '5' }, 'Conta Reduzida', 'A conta sintética não tem conta reduzida.'],
    ['reduzido fora do formato', { nivel: '5', classificacao: '4.1.1.1.002', pai: '4.1.1.1', tipo: 'A', reduzido: '9a' }, 'Conta Reduzida', 'A conta reduzida deve ter só números.'],
    ['descrição vazia', { nivel: '5', classificacao: '4.1.1.1.002', pai: '4.1.1.1', tipo: 'A', reduzido: '1', descricao: '  ' }, 'Descrição', 'A descrição é obrigatória.'],
    ['descrição acima de 200', { nivel: '5', classificacao: '4.1.1.1.002', pai: '4.1.1.1', tipo: 'A', reduzido: '1', descricao: 'd'.repeat(201) }, 'Descrição', 'A descrição deve ter até 200 caracteres.'],
    ['nível 1 com pai', { nivel: '1', classificacao: '5', pai: '4', tipo: 'S' }, 'Conta Superior', 'A conta de nível 1 não tem conta superior.'],
    ['nível 2 sem pai', { nivel: '5', classificacao: '4.1.1.1.002', pai: null, tipo: 'A', reduzido: '1' }, 'Conta Superior', 'A conta superior é obrigatória a partir do nível 2.'],
    ['tipo inválido', { nivel: '5', classificacao: '4.1.1.1.002', pai: '4.1.1.1', tipo: 'X', reduzido: '1' }, 'Tipo', 'O tipo deve ser S (sintética) ou A (analítica).'],
    ['pai analítico', { nivel: '5', classificacao: '4.1.1.1.001.1', pai: '4.1.1.1.001', tipo: 'A', reduzido: '1' }, 'Conta Superior', 'A conta superior não pode ser analítica.'],
  ] as const)('%s → erro', (_caso, linha, coluna, mensagem) => {
    expect(errosDe(...base, linha as Celulas)).toContainEqual({ linha: 7, coluna, mensagem });
  });
});
