import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dinheiro } from '@/shared/kernel';
import { criarCifraSalarios } from './cifra-salarios';
import { CHAVE_TESTE_CIFRA, ID_CHAVE_TESTE } from './cifra-teste';

// Cifra dos salários (plano do P4, Task 12a, Step 2; R7 e I6).
const ctx = { codigoCargo: 'C100', campo: 'salario_real' as const };
const fonte = (extra: Record<string, string> = {}) => ({ CHAVE_CIFRA_SALARIOS: CHAVE_TESTE_CIFRA, CHAVE_CIFRA_SALARIOS_ID: ID_CHAVE_TESTE, ...extra });
const cifra = criarCifraSalarios(fonte());
const valor = Dinheiro.de('7500.00');
const trocar = (envelope: string, i: number, f: (s: string) => string) => envelope.split(':').map((p, j) => (j === i ? f(p) : p)).join(':');

afterEach(() => vi.restoreAllMocks());

describe('cifra dos salários', () => {
  it('ida e volta; o envelope começa com v1:<id>: e não contém o valor', () => {
    const e = cifra.cifrar(valor, ctx);
    expect(e.startsWith(`v1:${ID_CHAVE_TESTE}:`)).toBe(true);
    expect(e).not.toContain('7500');
    expect(cifra.decifrar(e, ctx).paraString()).toBe('7500.00');
    expect(cifra.idChaveAtual()).toBe(ID_CHAVE_TESTE);
  });

  it('1.000 cifras do mesmo valor → 1.000 IVs distintos', () => {
    const ivs = new Set(Array.from({ length: 1000 }, () => cifra.cifrar(valor, ctx).split(':')[2]));
    expect(ivs.size).toBe(1000);
  });

  it('AAD de outro código, outro campo ou outro id de chave → erro', () => {
    const e = cifra.cifrar(valor, ctx);
    expect(() => cifra.decifrar(e, { ...ctx, codigoCargo: 'C101' })).toThrow(/decifrar/);
    expect(() => cifra.decifrar(e, { ...ctx, campo: 'salario_definido' })).toThrow(/decifrar/);
    // A mesma chave com outro id: o AAD muda, e a tag não fecha.
    const outroId = criarCifraSalarios(fonte({ CHAVE_CIFRA_SALARIOS_ID: 'outro', CHAVE_CIFRA_SALARIOS_ANTERIORES: `${ID_CHAVE_TESTE}:${CHAVE_TESTE_CIFRA}` }));
    expect(() => outroId.decifrar(trocar(e, 1, () => 'outro'), ctx)).toThrow(/decifrar/);
  });

  it('tag truncada para 12 bytes → erro (não aceita tag curta); 1 byte adulterado → erro', () => {
    const e = cifra.cifrar(valor, ctx);
    const curta = trocar(e, 3, (t) => Buffer.from(t, 'base64url').subarray(0, 12).toString('base64url'));
    expect(() => cifra.decifrar(curta, ctx)).toThrow(/decifrar/);
    const adulterada = trocar(e, 4, (c) => {
      const b = Buffer.from(c, 'base64url');
      b[0] = b[0]! ^ 1;
      return b.toString('base64url');
    });
    expect(() => cifra.decifrar(adulterada, ctx)).toThrow(/decifrar/);
    expect(() => cifra.decifrar('v2:x:y:z:w', ctx)).toThrow(/decifrar/);
  });

  it('chave de 31 bytes → erro que cita CHAVE_CIFRA_SALARIOS, sem o valor', () => {
    const curta = randomBytes(31).toString('base64');
    let msg = '';
    try {
      criarCifraSalarios(fonte({ CHAVE_CIFRA_SALARIOS: curta }));
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('CHAVE_CIFRA_SALARIOS');
    expect(msg).not.toContain(curta);
  });

  it('sem chave → cad.cifra_indisponivel, com o log [CIFRA_SALARIOS_AUSENTE]; criar não falha', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sem = criarCifraSalarios({});
    expect(() => sem.cifrar(valor, ctx)).toThrow(expect.objectContaining({ codigo: 'cad.cifra_indisponivel' }));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[CIFRA_SALARIOS_AUSENTE]'));
  });

  it('keyring: o envelope de k0 decifra com k0 em _ANTERIORES e k1 como atual; id desconhecido → erro', () => {
    const k0 = randomBytes(32).toString('base64');
    const k1 = randomBytes(32).toString('base64');
    const antiga = criarCifraSalarios({ CHAVE_CIFRA_SALARIOS: k0, CHAVE_CIFRA_SALARIOS_ID: 'k0' });
    const e = antiga.cifrar(valor, ctx);
    const nova = criarCifraSalarios({ CHAVE_CIFRA_SALARIOS: k1, CHAVE_CIFRA_SALARIOS_ID: 'k1', CHAVE_CIFRA_SALARIOS_ANTERIORES: `k0:${k0}` });
    expect(nova.decifrar(e, ctx).paraString()).toBe('7500.00');
    expect(nova.cifrar(valor, ctx).startsWith('v1:k1:')).toBe(true);
    const semK0 = criarCifraSalarios({ CHAVE_CIFRA_SALARIOS: k1, CHAVE_CIFRA_SALARIOS_ID: 'k1' });
    expect(() => semK0.decifrar(e, ctx)).toThrow(expect.objectContaining({ codigo: 'cad.cifra_invalida' }));
  });

  it('produção: a chave de teste é recusada; outra chave vale', () => {
    expect(() => criarCifraSalarios(fonte({ AMBIENTE: 'producao', NODE_ENV: 'production' }))).toThrow(/CIFRA_SALARIOS_CHAVE_DE_TESTE/);
    const real = randomBytes(32).toString('base64');
    expect(criarCifraSalarios({ CHAVE_CIFRA_SALARIOS: real, CHAVE_CIFRA_SALARIOS_ID: 'prod1', AMBIENTE: 'producao', NODE_ENV: 'production' }).idChaveAtual()).toBe('prod1');
  });

  it('_ANTERIORES malformado ou com id repetido → erro de configuração', () => {
    expect(() => criarCifraSalarios(fonte({ CHAVE_CIFRA_SALARIOS_ANTERIORES: 'semdoispontos' }))).toThrow(/ANTERIORES/);
    expect(() => criarCifraSalarios(fonte({ CHAVE_CIFRA_SALARIOS_ANTERIORES: `${ID_CHAVE_TESTE}:${CHAVE_TESTE_CIFRA}` }))).toThrow(/ANTERIORES/);
  });
});
