import { describe, expect, it } from 'vitest';
import { ErroDominio } from '@/shared/kernel';
import type { MensagemEmail } from './modelos-email';
import { renderizarEmail } from './renderizar-email';

const base: MensagemEmail = {
  modelo: 'usuario.senha_inicial',
  versao: 1,
  destinatario: { email: 'maria@ex.org', nome: 'Maria' },
  dados: { nome: 'Maria', login: 'maria.silva', senhaTemporaria: 'Tmp-123456', urlAcesso: 'https://sgo.exemplo/login' },
  criadoEm: '2026-10-26T12:00:00.000Z',
};

function codigo(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    expect(e).toBeInstanceOf(ErroDominio);
    return (e as ErroDominio).codigo;
  }
}

describe('renderizarEmail', () => {
  it('assunto com as etiquetas do módulo (RN0006) e corpo com login, senha e link', () => {
    const r = renderizarEmail(base, { nomeExibicao: '' });
    expect(r.assunto).toBe('[SGO 2.0][Acesso] Seu acesso ao sistema');
    expect(r.texto).toContain('Login: maria.silva');
    expect(r.texto).toContain('Senha temporária: Tmp-123456');
    expect(r.texto).toContain('https://sgo.exemplo/login');
    expect(r.html).toContain('<a href="https://sgo.exemplo/login">');
  });

  it('sem nome de exibição, o cabeçalho é só o do sistema', () => {
    const r = renderizarEmail(base, { nomeExibicao: '   ' });
    expect(r.texto.split('\n')[0]).toBe('SGO 2.0 – Sistema de Gestão Orçamentária');
  });

  it('com nome de exibição, ele entra no cabeçalho', () => {
    const r = renderizarEmail(base, { nomeExibicao: 'Instituição Exemplo' });
    expect(r.texto.split('\n')[0]).toBe('SGO 2.0 – Sistema de Gestão Orçamentária · Instituição Exemplo');
  });

  it('o modelo de senha redefinida tem o próprio assunto', () => {
    const r = renderizarEmail({ ...base, modelo: 'usuario.senha_redefinida' }, { nomeExibicao: '' });
    expect(r.assunto).toBe('[SGO 2.0][Acesso] Sua senha foi redefinida');
  });

  it('aviso de exportação: pronta leva ao download; com falha, aponta o motivo em Minhas exportações', () => {
    const exportacao = (resultado: 'pronta' | 'falhou'): MensagemEmail => ({
      ...base,
      modelo: 'exportacao.concluida',
      dados: { nome: 'Maria', titulo: 'Plano de contas', resultado, urlAcesso: 'https://sgo.exemplo/rel/exportacoes' },
    });
    const pronta = renderizarEmail(exportacao('pronta'), { nomeExibicao: '' });
    expect(pronta.assunto).toBe('[SGO 2.0][Exportação] Sua exportação terminou');
    expect(pronta.texto).toContain('A exportação "Plano de contas" que você pediu está pronta.');
    expect(pronta.texto).toContain('Baixar em Minhas exportações: https://sgo.exemplo/rel/exportacoes');
    const falhou = renderizarEmail(exportacao('falhou'), { nomeExibicao: '' });
    expect(falhou.texto).toContain('A exportação "Plano de contas" que você pediu não pôde ser gerada.');
    expect(falhou.texto).toContain('O motivo está em Minhas exportações.');
    expect(falhou.html).toContain('A exportação &quot;Plano de contas&quot;');
  });

  it('alerta de tentativas: assunto e texto do bloqueio e do limiar, com singular para 1 tentativa', () => {
    const alerta = (bloqueado: boolean, tentativas: number): MensagemEmail => ({
      ...base,
      modelo: 'usuario.alerta_tentativas',
      dados: { nomeAdministrador: 'Ana', nomeUsuario: 'João <x>', login: 'joao', tentativas, bloqueado, dataHora: '10/11/2026 18:30', urlAcesso: 'https://sgo.exemplo/adm/usuarios' },
    });
    const b = renderizarEmail(alerta(true, 5), { nomeExibicao: '' });
    expect(b.assunto).toBe('[SGO 2.0][Acesso] Usuário bloqueado por tentativas de acesso');
    expect(b.texto).toContain('O usuário João <x> foi bloqueado depois de 5 tentativas de acesso malsucedidas.');
    expect(b.texto).toContain('Login: joao');
    expect(b.texto).toContain('Data e hora: 10/11/2026 18:30');
    expect(b.html).toContain('João &lt;x&gt;');
    const l = renderizarEmail(alerta(false, 1), { nomeExibicao: '' });
    expect(l.assunto).toBe('[SGO 2.0][Acesso] Tentativas de acesso malsucedidas');
    expect(l.texto).toContain('O usuário João <x> teve 1 tentativa de acesso malsucedida.');
    expect(l.texto).toContain('Abrir Administração → Usuários: https://sgo.exemplo/adm/usuarios');
  });

  it('escapa no HTML todo dado e o nome de exibição', () => {
    const r = renderizarEmail(
      { ...base, dados: { ...base.dados, nome: '<script>alert(1)</script>', login: 'a"b', senhaTemporaria: "x'&<y" } },
      { nomeExibicao: '<b>Inst</b>' },
    );
    expect(r.html).not.toContain('<script>');
    expect(r.html).not.toContain('<b>Inst</b>');
    expect(r.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(r.html).toContain('a&quot;b');
    expect(r.html).toContain('x&#39;&amp;&lt;y');
    expect(r.html).toContain('&lt;b&gt;Inst&lt;/b&gt;');
  });

  it('aspas no link não saem do atributo href', () => {
    const r = renderizarEmail(
      { ...base, dados: { ...base.dados, urlAcesso: 'https://sgo.exemplo/login" onclick="x' } },
      { nomeExibicao: '' },
    );
    expect(r.html).toContain('href="https://sgo.exemplo/login&quot; onclick=&quot;x"');
  });

  it('versão desconhecida → email.modelo_desconhecido', () => {
    expect(codigo(() => renderizarEmail({ ...base, versao: 99 }, { nomeExibicao: '' }))).toBe('email.modelo_desconhecido');
  });

  it('modelo desconhecido → email.modelo_desconhecido', () => {
    expect(codigo(() => renderizarEmail({ ...base, modelo: 'x.y' } as never, { nomeExibicao: '' }))).toBe('email.modelo_desconhecido');
  });

  it.each(['constructor', '__proto__', 'toString', 1.5, '1'])('versão %j do protótipo ou não inteira → modelo_desconhecido', (versao) => {
    expect(codigo(() => renderizarEmail({ ...base, versao } as never, { nomeExibicao: '' }))).toBe('email.modelo_desconhecido');
  });

  it('modelo "constructor" → modelo_desconhecido', () => {
    expect(codigo(() => renderizarEmail({ ...base, modelo: 'constructor' } as never, { nomeExibicao: '' }))).toBe('email.modelo_desconhecido');
  });

  it.each(['Inst\r\nBcc: x@y.org', 'Inst\u0000', 'x'.repeat(121)])('nome de exibição %j → erro', (nomeExibicao) => {
    expect(codigo(() => renderizarEmail(base, { nomeExibicao }))).toBe('email.nome_exibicao_invalido');
  });
});
