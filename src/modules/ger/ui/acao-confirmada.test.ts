import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as ger from '@/modules/ger';
import { AcaoConfirmada, dadosDaAcao, MENSAGEM_FALHA_ACAO } from './acao-confirmada';

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
    expect(h).toContain(`role="alertdialog" aria-labelledby="${id}"`);
    expect(h).toMatch(/>Sim<\/button>/);
    expect(h).toMatch(/>Não<\/button>/);
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
