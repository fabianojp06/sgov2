import { describe, expect, it } from 'vitest';
import { entradaAlteracao, entradaCadastro, entradaId } from './entrada-usuario';

const UNIDADE = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

function formulario(campos: [string, string][]): FormData {
  const f = new FormData();
  for (const [k, v] of campos) f.append(k, v);
  return f;
}

const completo = (): [string, string][] => [
  ['nome', 'Ana Maria'],
  ['email', 'ana@example.org'],
  ['login', 'ana.maria'],
  ['ativo', 'on'],
  ['perfis', 'ORCAMENTISTA'],
  ['perfis', 'GFIN'],
  ['unidades', UNIDADE],
  ['ccEscopo', ''],
];

// O Formulario do C3 entrega FormData: a entrada da definirAcao converte antes de validar.
describe('entradaCadastro', () => {
  it('perfis e unidades com getAll, checkbox marcado vira true e CC vazio vira null', () => {
    expect(entradaCadastro.parse(formulario(completo()))).toEqual({
      nome: 'Ana Maria',
      email: 'ana@example.org',
      login: 'ana.maria',
      ativo: true,
      perfis: ['ORCAMENTISTA', 'GFIN'],
      unidades: [UNIDADE],
      ccEscopo: null,
    });
  });

  it('checkbox desmarcado (ausente) vira false; sem perfil nem unidade, listas vazias', () => {
    const r = entradaCadastro.parse(formulario([['nome', 'Ana'], ['email', 'a@b.org'], ['login', 'ana']]));
    expect(r).toMatchObject({ ativo: false, perfis: [], unidades: [], ccEscopo: null });
  });

  it('CC preenchido segue como texto; campo ausente vira texto vazio (a validação do domínio responde)', () => {
    const r = entradaCadastro.parse(formulario([['ccEscopo', '1.2']]));
    expect(r).toMatchObject({ nome: '', email: '', login: '', ccEscopo: '1.2' });
  });

  it('arquivo no lugar de texto não passa como texto', () => {
    const f = new FormData();
    f.append('nome', new Blob(['x']), 'x.txt');
    expect(entradaCadastro.parse(f)).toMatchObject({ nome: '' });
  });

  it('objeto comum (chamada direta) segue sem conversão', () => {
    expect(entradaCadastro.parse({ nome: 'Ana' })).toEqual({ nome: 'Ana' });
  });
});

describe('entradaAlteracao', () => {
  it('id e versão separados dos dados do usuário', () => {
    const r = entradaAlteracao.parse(formulario([['id', UNIDADE], ['versao', '3'], ...completo()]));
    expect(r.id).toBe(UNIDADE);
    expect(r.versao).toBe(3);
    expect(r.dados).toMatchObject({ nome: 'Ana Maria', perfis: ['ORCAMENTISTA', 'GFIN'] });
    expect(r.dados).not.toHaveProperty('id');
    expect(r.dados).not.toHaveProperty('versao');
  });

  it.each([['x'], [''], ['-1'], ['1.5'], [' '], ['1e2'], [' 3']])('versão inválida %j: erro', (versao) => {
    const r = entradaAlteracao.safeParse(formulario([['id', UNIDADE], ['versao', versao]]));
    expect(r.success).toBe(false);
  });
});

describe('entradaId', () => {
  it('aceita FormData ou objeto com id', () => {
    expect(entradaId.parse(formulario([['id', UNIDADE]]))).toEqual({ id: UNIDADE });
    expect(entradaId.parse({ id: UNIDADE })).toEqual({ id: UNIDADE });
  });
  it('sem id: erro', () => expect(entradaId.safeParse({}).success).toBe(false));
});
