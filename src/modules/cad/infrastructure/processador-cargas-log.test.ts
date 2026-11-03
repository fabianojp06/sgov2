import { describe, expect, it } from 'vitest';
import { Prisma } from '@/generated/prisma/client';
import { diagnostico, textoSemValores } from './processador-cargas';

// Log do lote sem dados da linha (pendência da Task 12a): o meta do Prisma e a mensagem do banco.
const ENVELOPE = 'v1:teste1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBB:CCCC';

describe('log das cargas sem valores', () => {
  it('a mensagem do Postgres perde a linha que falhou e os valores da chave', () => {
    expect(textoSemValores(`new row for relation "cargo" violates check constraint "cargo_salario_real_envelope" Failing row contains (C1, Analista, ${ENVELOPE}).`)).toBe(
      'new row for relation "cargo" violates check constraint "cargo_salario_real_envelope"',
    );
    expect(textoSemValores('duplicate key value violates unique constraint "cargo_codigo_key" DETAIL: Key (codigo)=(C1) already exists.')).toBe('duplicate key value violates unique constraint "cargo_codigo_key"');
    expect(textoSemValores('Key (codigo)=(C1) is still referenced')).toBe('Key (codigo)=(…)');
    // Valor com ")" dentro não escapa.
    expect(textoSemValores('Key (nome)=(a) b) already exists')).toBe('Key (nome)=(…)');
    // Português.
    expect(textoSemValores('o novo registro da relação "cargo" viola a restrição de verificação "x" Detalhe: A linha que falhou contém (C1).')).toBe(
      'o novo registro da relação "cargo" viola a restrição de verificação "x"',
    );
  });

  it('valores entre aspas depois do ": " (P2007, P2020) saem; nomes de relação e restrição antes dele ficam', () => {
    expect(textoSemValores('Invalid input value: invalid input syntax for type uuid: "abc-salario"')).toBe('Invalid input value: invalid input syntax for type uuid: "…"');
    expect(textoSemValores('Value out of range for the type: value "99999999999" is out of range for type integer')).toBe('Value out of range for the type: value "…" is out of range for type integer');
    expect(textoSemValores('new row for relation "cargo" violates check constraint "cargo_x"')).toBe('new row for relation "cargo" violates check constraint "cargo_x"');
  });

  it('do meta do Prisma, só as chaves de estrutura', () => {
    const e = new Prisma.PrismaClientKnownRequestError(`Invalid invocation:\nnew row violates check constraint "x" Failing row contains (${ENVELOPE})`, {
      code: 'P2004',
      clientVersion: '7',
      meta: {
        modelName: 'Cargo',
        constraint: 'x',
        target: ['codigo', 7],
        driverAdapterError: { cause: { kind: 'CheckViolation', originalCode: '23514', table: 'cargo', constraint: { index: 'cargo_x' }, originalMessage: ENVELOPE, detail: ENVELOPE } },
      },
    });
    const d = diagnostico(e);
    expect(d).toEqual({
      erro: 'PrismaClientKnownRequestError',
      code: 'P2004',
      meta: { modelName: 'Cargo', constraint: 'x', causa: { kind: 'CheckViolation', originalCode: '23514', table: 'cargo', constraint: 'cargo_x' } },
      mensagem: 'new row violates check constraint "x"',
    });
    expect(JSON.stringify(d)).not.toContain(ENVELOPE);
  });

  it('outro erro: a mensagem também passa pelo filtro', () => {
    expect(diagnostico(new Error(`falhou: Failing row contains (${ENVELOPE})`))).toEqual({ erro: 'Error', mensagem: 'falhou:' });
    expect(diagnostico('x')).toEqual({ erro: 'desconhecido' });
    const u = new Prisma.PrismaClientUnknownRequestError(`Erro\nKey (codigo)=(C1) ${ENVELOPE}`, { clientVersion: '7' });
    expect(JSON.stringify(diagnostico(u))).not.toContain(ENVELOPE);
  });
});
