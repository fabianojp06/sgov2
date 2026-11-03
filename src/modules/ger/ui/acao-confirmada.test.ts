import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { redirect } from 'next/navigation';
import { describe, expect, it } from 'vitest';
import * as ger from '@/modules/ger';
import { AcaoConfirmada, dadosDaAcao, executarAcao, MENSAGEM_FALHA_ACAO } from './acao-confirmada';

// AcaoConfirmada do C3 (#230): a caixa Sim/Não que o adm e o orc tinham em cópia.
const acao = async () => ({ ok: true as const, valor: undefined });
const props = { rotulo: 'Aprovar', pergunta: 'Deseja realmente aprovar 2027?', acao, campos: { id: 'e1', versao: '3' } };

describe('AcaoConfirmada (C3)', () => {
  it('fechada: só o botão e a região viva vazia, sem a caixa', () => {
    const h = renderToString(createElement(AcaoConfirmada, props));
    expect(h).toMatch(/<button type="button">Aprovar<\/button>/);
    expect(h).not.toContain('alertdialog');
    expect(h).toContain('<p role="status"></p>');
    expect(h).not.toContain('role="alert"');
  });

  it('aberta: alertdialog rotulado pela pergunta, com Sim e Não', () => {
    const h = renderToString(createElement(AcaoConfirmada, { ...props, aberto: true }));
    const id = /<p id="([^"]+)">Deseja realmente aprovar 2027\?<\/p>/.exec(h)?.[1];
    expect(id).toBeDefined();
    expect(h).toMatch(/<div[^>]*role="alertdialog"/);
    expect(h).toMatch(new RegExp(`<div[^>]*aria-labelledby="${id}"`));
    // Não modal de propósito (UC02.13 A7/A8); botões que nunca enviam um form.
    expect(h).not.toContain('aria-modal');
    expect(h).toMatch(/<button type="button">Sim<\/button>/);
    expect(h).toMatch(/<button type="button">Não<\/button>/);
    // Aberta não é sucesso: a região viva continua vazia.
    expect(renderToString(createElement(AcaoConfirmada, { ...props, aberto: true, mensagemSucesso: 'Aprovado.' }))).toContain('<p role="status"></p>');
  });

  it('executarAcao: sucesso, erros do Resultado, exceção vira a mensagem genérica, redirect segue para o Next', async () => {
    const recebidos: [string, FormDataEntryValue][][] = [];
    expect(await executarAcao(async (d) => (recebidos.push([...d.entries()]), { ok: true, valor: 1 }), { id: 'e1' })).toEqual({ sucesso: true });
    expect(recebidos).toEqual([[['id', 'e1']]]);
    const erros = [{ campo: 'versao', mensagem: 'Recarregue a tela.' }];
    expect(await executarAcao(async () => ({ ok: false, erros }), {})).toEqual({ erros });
    expect(await executarAcao(async () => Promise.reject(new Error('banco fora')), {})).toEqual({ erros: [{ campo: '', mensagem: MENSAGEM_FALHA_ACAO }] });
    await expect(executarAcao(async () => redirect('/orc/exercicios'), {})).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });
  });

  it('os campos viram o FormData da ação', () => {
    const d = dadosDaAcao({ id: 'e1', versao: '3' });
    expect([...d.entries()]).toEqual([
      ['id', 'e1'],
      ['versao', '3'],
    ]);
    expect(MENSAGEM_FALHA_ACAO).toBe('Não foi possível concluir a operação. Tente novamente.');
  });

  it('exportada pelo index.ts do ger', () => {
    expect(ger.AcaoConfirmada).toBe(AcaoConfirmada);
    expect(ger.MENSAGEM_FALHA_ACAO).toBe(MENSAGEM_FALHA_ACAO);
  });
});
