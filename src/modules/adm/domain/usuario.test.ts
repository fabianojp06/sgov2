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
