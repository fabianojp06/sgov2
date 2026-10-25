import { describe, expect, it, vi } from 'vitest';
import { $Enums } from '@/generated/prisma/client';
import type { TxCliente } from '@/shared/db';
import { auditar } from './auditar';
import { ORIGENS_OPERACAO, TIPOS_OPERACAO, type EventoAuditoria } from './tipos';

// Transação falsa: só registra o que seria gravado.
function txFalsa() {
  const create = vi.fn(async () => ({}));
  return { tx: { historicoOperacao: { create } } as unknown as TxCliente, create };
}

const base: EventoAuditoria = {
  contexto: { usuarioId: null, usuarioRotulo: 'admin', sessaoUid: null, ip: null },
  funcionalidade: 'Usuários',
  tipo: 'CONSULTA',
};

const invalido = expect.objectContaining({ codigo: 'AUDITORIA_INVALIDA' });

describe('auditar: validação do evento (revisão 12.12)', () => {
  it.each([
    ['INSERCAO sem depois', { tipo: 'INSERCAO', registroId: '1' }],
    ['INSERCAO sem registroId', { tipo: 'INSERCAO', depois: { a: 1 } }],
    ['ALTERACAO sem antes', { tipo: 'ALTERACAO', registroId: '1', depois: { a: 1 } }],
    ['ALTERACAO sem depois', { tipo: 'ALTERACAO', registroId: '1', antes: { a: 1 } }],
    ['EXCLUSAO sem antes', { tipo: 'EXCLUSAO', registroId: '1' }],
    ['registroId vazio', { tipo: 'EXCLUSAO', registroId: ' ', antes: { a: 1 } }],
    ['descricao vazia', { descricao: '  ' }],
    ['usuarioId que não é UUID', { contexto: { ...base.contexto, usuarioId: 'admin' } }],
    ['unidadeId que não é UUID', { contexto: { ...base.contexto, unidadeId: '' } }],
    ['ip que não é IP', { contexto: { ...base.contexto, ip: 'unknown' } }],
    ['ip com vários saltos', { contexto: { ...base.contexto, ip: '1.2.3.4, 5.6.7.8' } }],
  ])('recusa %s', async (_caso, parcial) => {
    const { tx, create } = txFalsa();
    await expect(auditar(tx, { ...base, ...parcial } as EventoAuditoria)).rejects.toThrow(invalido);
    expect(create).not.toHaveBeenCalled();
  });

  it('aceita UUID, IPv4 e IPv6', async () => {
    const { tx, create } = txFalsa();
    const contexto = { ...base.contexto, usuarioId: '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c', ip: '::1' };
    await auditar(tx, { ...base, contexto });
    await auditar(tx, { ...base, contexto: { ...contexto, ip: '10.0.0.1' } });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('recusa ser chamada fora de uma transação (cliente raiz do Prisma)', async () => {
    const { tx } = txFalsa();
    const raiz = Object.assign(tx, { $connect: vi.fn(), $transaction: vi.fn() });
    await expect(auditar(raiz, base)).rejects.toThrow(expect.objectContaining({ codigo: 'AUDITORIA_FORA_DA_TRANSACAO' }));
  });

  it('dado ausente vira NULL do banco, não JSON null', async () => {
    const { tx, create } = txFalsa();
    await auditar(tx, base);
    const dados = (create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    const { Prisma } = await import('@/generated/prisma/client');
    expect([dados.antes, dados.depois, dados.delta]).toEqual([Prisma.DbNull, Prisma.DbNull, Prisma.DbNull]);
  });
});

describe('enums do TypeScript iguais aos do Prisma, nos dois sentidos', () => {
  it('TipoOperacao', () => expect([...TIPOS_OPERACAO].sort()).toEqual(Object.values($Enums.TipoOperacao).sort()));
  it('OrigemOperacao', () =>
    expect([...ORIGENS_OPERACAO].sort()).toEqual(Object.values($Enums.OrigemOperacao).sort()));
});
