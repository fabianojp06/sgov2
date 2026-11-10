import { describe, expect, it } from 'vitest';
import { ErroDominio } from '@/shared/kernel';
import { validarDadosModelo } from './modelos-email';

const URL = 'https://sgo.exemplo';
const dados = { nome: 'Maria', login: 'maria.silva', senhaTemporaria: 'Tmp-123456', urlAcesso: `${URL}/login` };

function erro(fn: () => unknown): ErroDominio | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    expect(e).toBeInstanceOf(ErroDominio);
    return e as ErroDominio;
  }
}

describe('validarDadosModelo', () => {
  it('aceita o link exatamente ${URL_PUBLICA}/login', () => {
    expect(() => validarDadosModelo('usuario.senha_inicial', dados, URL)).not.toThrow();
  });

  it.each([
    'http://sgo.exemplo/login',
    'https://sgo.exemplo/login?x=1',
    'https://sgo.exemplo/login#a',
    'https://u:p@sgo.exemplo/login',
    'https://outro/login',
    'https://sgo.exemplo/login/',
    'https://sgo.exemplo',
    'javascript:alert(1)',
    '',
  ])('recusa o link %j', (urlAcesso) => {
    expect(erro(() => validarDadosModelo('usuario.senha_inicial', { ...dados, urlAcesso }, URL))?.detalhes).toEqual({ campo: 'urlAcesso' });
  });

  it.each([
    ['nome', 'Maria\r\nBcc: x@y.org'],
    ['nome', ''],
    ['nome', 'x'.repeat(121)],
    ['login', 'a\tb'],
    ['senhaTemporaria', 'x'.repeat(129)],
    ['senhaTemporaria', 123],
  ])('recusa %s = %j sem expor o valor', (campo, valor) => {
    const e = erro(() => validarDadosModelo('usuario.senha_redefinida', { ...dados, [campo]: valor }, URL));
    expect(e?.codigo).toBe('email.dados_invalidos');
    expect(e?.detalhes).toEqual({ campo });
  });

  it('aviso de exportação: link exatamente ${URL_PUBLICA}/rel/exportacoes, título e resultado conhecidos', () => {
    const ok = { nome: 'Maria', titulo: 'Plano de contas', resultado: 'pronta', urlAcesso: `${URL}/rel/exportacoes` };
    expect(() => validarDadosModelo('exportacao.concluida', ok, URL)).not.toThrow();
    expect(() => validarDadosModelo('exportacao.concluida', { ...ok, resultado: 'falhou' }, URL)).not.toThrow();
    expect(erro(() => validarDadosModelo('exportacao.concluida', { ...ok, urlAcesso: `${URL}/login` }, URL))?.detalhes).toEqual({ campo: 'urlAcesso' });
    expect(erro(() => validarDadosModelo('exportacao.concluida', { ...ok, resultado: 'outro' }, URL))?.detalhes).toEqual({ campo: 'resultado' });
    expect(erro(() => validarDadosModelo('exportacao.concluida', { ...ok, titulo: 'x'.repeat(121) }, URL))?.detalhes).toEqual({ campo: 'titulo' });
    expect(erro(() => validarDadosModelo('usuario.senha_inicial', { ...dados, urlAcesso: `${URL}/rel/exportacoes` }, URL))?.detalhes).toEqual({ campo: 'urlAcesso' });
  });

  it('recusa dados que não são objeto', () => {
    expect(erro(() => validarDadosModelo('usuario.senha_inicial', null, URL))?.codigo).toBe('email.dados_invalidos');
    expect(erro(() => validarDadosModelo('usuario.senha_inicial', [], URL))?.codigo).toBe('email.dados_invalidos');
  });

  it('modelo desconhecido → email.modelo_desconhecido', () => {
    expect(erro(() => validarDadosModelo('x.y' as never, dados, URL))?.codigo).toBe('email.modelo_desconhecido');
    expect(erro(() => validarDadosModelo('toString' as never, dados, URL))?.codigo).toBe('email.modelo_desconhecido');
  });
});
