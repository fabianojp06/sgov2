import { describe, expect, it } from 'vitest';
import { MENSAGENS_USUARIO, perdeUltimoAdministrador, validarUsuario } from './usuario';

const base = {
  nome: 'Ana Maria',
  email: 'ana@example.org',
  login: 'ana.maria',
  ativo: true,
  perfis: ['ORCAMENTISTA'],
  unidades: [],
  ccEscopo: null,
};

const campos = (r: ReturnType<typeof validarUsuario>) => (r.ok ? [] : r.erros.map((e) => e.campo));

describe('validarUsuario (UC02.12, UC02.13)', () => {
  it('dados válidos: login aparado, perfis sem repetição e CC vazio vira null', () => {
    const r = validarUsuario({ ...base, login: '  ana.maria ', perfis: ['ORCAMENTISTA', 'ORCAMENTISTA'], ccEscopo: '' });
    expect(r).toEqual({ ok: true, valor: { ...base, login: 'ana.maria', loginNormalizado: 'ana.maria' } });
  });

  it('login com maiúsculas é normalizado (RN0518)', () => {
    const r = validarUsuario({ ...base, login: 'Ana.Maria' });
    expect(r.ok && r.valor).toMatchObject({ login: 'Ana.Maria', loginNormalizado: 'ana.maria' });
  });

  it('sem perfil: erro em perfis (RN0079)', () => {
    const r = validarUsuario({ ...base, perfis: [] });
    expect(r).toEqual({ ok: false, erros: [{ campo: 'perfis', mensagem: MENSAGENS_USUARIO.PERFIL_OBRIGATORIO }] });
  });

  it('perfil fora do catálogo: erro em perfis', () => expect(campos(validarUsuario({ ...base, perfis: ['SUPER'] }))).toEqual(['perfis']));

  it('GESTOR_DIRETORIA sem CC de escopo, ou CC sem esse perfil: erro em ccEscopo (C25)', () => {
    expect(validarUsuario({ ...base, perfis: ['GESTOR_DIRETORIA'] })).toEqual({
      ok: false,
      erros: [{ campo: 'ccEscopo', mensagem: MENSAGENS_USUARIO.CC_OBRIGATORIO }],
    });
    expect(validarUsuario({ ...base, ccEscopo: '1.2' })).toEqual({
      ok: false,
      erros: [{ campo: 'ccEscopo', mensagem: MENSAGENS_USUARIO.CC_SEM_PERFIL }],
    });
    expect(validarUsuario({ ...base, perfis: ['GESTOR_DIRETORIA'], ccEscopo: ' 1.2 ' }).ok).toBe(true);
  });

  it.each([['ab'], ['-ana'], ['ana maria'], ['ána'], ['']])('login inválido %j: erro em login', (login) =>
    expect(campos(validarUsuario({ ...base, login }))).toEqual(['login']));

  it.each([['ana'], ['ana@'], ['ana@exemplo'], ['ana @example.org'], ['a,b@example.org']])('e-mail inválido %j: erro em email', (email) =>
    expect(campos(validarUsuario({ ...base, email }))).toEqual(['email']));

  it('nome vazio, longo ou com caracteres que quebrariam o destinatário do e-mail', () => {
    expect(campos(validarUsuario({ ...base, nome: '  ' }))).toEqual(['nome']);
    expect(campos(validarUsuario({ ...base, nome: 'x'.repeat(121) }))).toEqual(['nome']);
    expect(campos(validarUsuario({ ...base, nome: 'Ana <ana@x.org>' }))).toEqual(['nome']);
    expect(campos(validarUsuario({ ...base, nome: 'Ana\nMaria' }))).toEqual(['nome']);
  });

  it('nenhuma chave de senha passa (RN0059)', () => {
    const r = validarUsuario({ ...base, senha: 'Digitada123', senhaHash: 'x' });
    expect(r.ok && Object.keys(r.valor)).not.toContain('senha');
    expect(r.ok && Object.keys(r.valor)).not.toContain('senhaHash');
  });

  it('unidade que não é uuid: erro em unidades', () => expect(campos(validarUsuario({ ...base, unidades: ['x'] }))).toEqual(['unidades']));

  it('separadores de linha e invisíveis no nome são recusados, como no contrato de e-mail (C4)', () => {
    for (const codigo of [0x2028, 0x2029, 0x200b, 0x200e, 0x202e, 0xfeff, 0x061c]) {
      expect(campos(validarUsuario({ ...base, nome: `Ana${String.fromCharCode(codigo)}Maria` }))).toEqual(['nome']);
    }
    expect(campos(validarUsuario({ ...base, nome: 'Ana, Maria' }))).toEqual(['nome']);
  });

  it('nome normalizado em NFC e com 120 caracteres aceito', () => {
    const decomposto = 'Jose' + String.fromCharCode(0x0301);
    const r = validarUsuario({ ...base, nome: decomposto });
    expect(r.ok && r.valor.nome).toBe('Jos' + String.fromCharCode(0xe9));
    expect(validarUsuario({ ...base, nome: 'x'.repeat(120) }).ok).toBe(true);
  });

  it('CC de escopo: só espaços vira null; longo ou com controle dá CC_INVALIDO', () => {
    expect(validarUsuario({ ...base, ccEscopo: '   ' }).ok).toBe(true);
    const gestor = { ...base, perfis: ['GESTOR_DIRETORIA'] };
    expect(validarUsuario({ ...gestor, ccEscopo: '1'.repeat(61) })).toEqual({
      ok: false,
      erros: [{ campo: 'ccEscopo', mensagem: MENSAGENS_USUARIO.CC_INVALIDO }],
    });
    expect(campos(validarUsuario({ ...gestor, ccEscopo: `1.2${String.fromCharCode(0x0a)}3` }))).toEqual(['ccEscopo']);
  });

  it('unidades repetidas saem uma vez; mais de 200 dá erro', () => {
    const u = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    const r = validarUsuario({ ...base, unidades: [u, u] });
    expect(r.ok && r.valor.unidades).toEqual([u]);
    expect(campos(validarUsuario({ ...base, unidades: Array.from({ length: 201 }, () => u) }))).toEqual(['unidades']);
  });

  it('campo ausente: mensagem em português', () => {
    const semAtivo: Record<string, unknown> = { ...base };
    delete semAtivo.ativo;
    const r = validarUsuario(semAtivo);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.erros[0]).toMatchObject({ campo: 'ativo' });
    expect(!r.ok && r.erros[0]?.mensagem).not.toMatch(/Invalid|expected/);
  });

  it('e-mail com mais de 254 caracteres: erro em email', () =>
    expect(campos(validarUsuario({ ...base, email: `${'a'.repeat(250)}@example.org` }))).toEqual(['email']));
});

describe('perdeUltimoAdministrador', () => {
  const admin = { ativo: true, bloqueado: false, perfis: ['ADMINISTRADOR'] };
  it('tirar o perfil ou inativar o único administrador ativo: perde', () => {
    expect(perdeUltimoAdministrador(admin, { ativo: true, perfis: ['ORCAMENTISTA'] }, 0)).toBe(true);
    expect(perdeUltimoAdministrador(admin, { ativo: false, perfis: ['ADMINISTRADOR'] }, 0)).toBe(true);
  });
  it('com outro administrador ativo, ou se ele continua administrador ativo: não perde', () => {
    expect(perdeUltimoAdministrador(admin, { ativo: false, perfis: [] }, 1)).toBe(false);
    expect(perdeUltimoAdministrador(admin, { ativo: true, perfis: ['ADMINISTRADOR', 'GFIN'] }, 0)).toBe(false);
  });
  it('quem não era administrador ativo e desbloqueado não conta', () => {
    expect(perdeUltimoAdministrador({ ...admin, ativo: false }, { ativo: false, perfis: [] }, 0)).toBe(false);
    expect(perdeUltimoAdministrador({ ...admin, bloqueado: true }, { ativo: true, perfis: [] }, 0)).toBe(false);
    expect(perdeUltimoAdministrador({ ativo: true, bloqueado: false, perfis: ['GFIN'] }, { ativo: false, perfis: [] }, 0)).toBe(false);
  });
});
