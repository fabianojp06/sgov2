import { describe, expect, it } from 'vitest';
import { CENTROS_CUSTO_EXEMPLO, estruturaFinanceiraFalsa, type NoCentroCusto } from '@/modules/cad/servidor';

// Cópia da árvore com o nó da classificação dada inativo.
function marcarInativo(no: NoCentroCusto, classificacao: string): NoCentroCusto {
  return { ...no, ativo: no.classificacao === classificacao ? false : no.ativo, filhos: no.filhos.map((f) => marcarInativo(f, classificacao)) };
}
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import type { TxCliente } from '@/shared/db';
import { exigirEscopoTotal, exigirSemEscopo, resolverEscopo } from './escopo';

const ctx = { usuarioId: 'u1', usuarioRotulo: 'u', sessaoUid: 's', ip: null, permissoes: new Set<string>() } as ContextoRequisicao;
const tx = {} as TxCliente;

// R16 do plano do P6: o escopo falha fechado.
describe('resolverEscopo', async () => {
  const indice = await estruturaFinanceiraFalsa().carregarIndiceEstrutura(tx);
  const com = (raiz: string | null) => resolverEscopo(tx, ctx, indice, { obterEscopo: async () => raiz });

  it('sem CC de escopo: TOTAL', async () => expect(await com(null)).toEqual({ tipo: 'TOTAL' }));

  it("'4.3': os analíticos ativos sob 4.3", async () => {
    const e = await com('4.3');
    expect(e.tipo).toBe('SUBARVORE');
    expect(e.tipo === 'SUBARVORE' && [...e.ccs]).toEqual(indice.centrosCustoAnaliticosSob('4.3'));
    expect(e.tipo === 'SUBARVORE' && e.ccs.size).toBeGreaterThan(0);
  });

  it('raiz inativa: conjunto vazio, nunca TOTAL', async () => {
    const inativa = CENTROS_CUSTO_EXEMPLO.map((n) => (n.classificacao === '4' ? marcarInativo(n, '4.3') : n));
    const ind = await estruturaFinanceiraFalsa({ centrosCusto: inativa }).carregarIndiceEstrutura(tx);
    const e = await resolverEscopo(tx, ctx, ind, { obterEscopo: async () => '4.3' });
    expect(e).toEqual({ tipo: 'SUBARVORE', raiz: '4.3', ccs: new Set() });
  });

  it('raiz ausente do índice: conjunto vazio, nunca TOTAL', async () => {
    const e = await com('9.9.9');
    expect(e).toEqual({ tipo: 'SUBARVORE', raiz: '9.9.9', ccs: new Set() });
  });
});

describe('exigirEscopoTotal (R15)', () => {
  it('TOTAL passa; SUBARVORE lança ErroPermissao com a funcionalidade e a ação', () => {
    expect(() => exigirEscopoTotal({ tipo: 'TOTAL' }, 'orc.orcamento', 'alterar')).not.toThrow();
    expect(() => exigirEscopoTotal({ tipo: 'SUBARVORE', raiz: '4.3', ccs: new Set(['4.3.0']) }, 'orc.orcamento', 'alterar')).toThrow(
      expect.objectContaining({ funcionalidade: 'orc.orcamento', acao: 'alterar' }),
    );
    expect(() => exigirEscopoTotal({ tipo: 'SUBARVORE', raiz: '4.3', ccs: new Set() }, 'orc.receitas', 'consultar')).toThrow(ErroPermissao);
  });
});

describe('exigirSemEscopo (R15, antes da trava)', () => {
  it('sem CC de escopo passa; com CC de escopo (mesmo inexistente) lança ErroPermissao', async () => {
    await expect(exigirSemEscopo(tx, ctx, { obterEscopo: async () => null }, 'orc.orcamento', 'alterar')).resolves.toBeUndefined();
    await expect(exigirSemEscopo(tx, ctx, { obterEscopo: async () => '9.9' }, 'orc.orcamento', 'alterar')).rejects.toBeInstanceOf(ErroPermissao);
  });
});
