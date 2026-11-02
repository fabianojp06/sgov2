import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { alterarBeneficio, incluirBeneficio } from './acoes-beneficios';

// Server Actions da Tabela Mestre (plano do P4, Task 10; §10.2 item 3): a negação é 403 auditado
// pela definirAcao, sem chegar ao caso de uso.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('./beneficios', () => ({ alterarBeneficioMestre: vi.fn(), incluirBeneficioMestre: vi.fn() }));

const gfin: ContextoRequisicao = {
  usuarioId: '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c',
  usuarioRotulo: 'gfin',
  sessaoUid: 's1',
  ip: '10.0.0.1',
  permissoes: new Set(['cad.beneficios:consultar']),
};
let negacoes: EventoAuditoria[];
beforeEach(() => {
  negacoes = [];
  configurarProvedorContexto({ obter: async () => gfin });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e);
  });
});

const entrada = {
  ano: 2027,
  codigo: 'beneficio.vr',
  nome: 'Vale-refeição',
  forma: 'VALOR_DIARIO',
  valor: '36.50',
  percentual: null,
  conta: '4.1.1.1.009',
  padraoPosicao: true,
  ativo: true,
};

describe('ações da Tabela Mestre', () => {
  it('GFIN (só consultar) ao alterar → 403 auditado', async () => {
    const r = await alterarBeneficio({ ...entrada, versao: 1 });
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(negacoes).toEqual([expect.objectContaining({ funcionalidade: 'cad.beneficios' })]);
  });

  it('GFIN ao incluir → 403 auditado', async () => {
    expect(await incluirBeneficio(entrada)).toMatchObject({ ok: false, status: 403 });
    expect(negacoes).toHaveLength(1);
  });

  it('campo desconhecido no pedido é recusado pelo schema (.strict), sem descarte silencioso', async () => {
    configurarProvedorContexto({ obter: async () => ({ ...gfin, permissoes: new Set(['cad.beneficios:alterar']) }) });
    const r = await alterarBeneficio({ ...entrada, versao: 1, versaoItem: 1 });
    expect(r.ok).toBe(false);
    expect('status' in r).toBe(false);
  });
});
