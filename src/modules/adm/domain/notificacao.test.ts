import { describe, expect, it } from 'vitest';
import { CONTA_TODAS, MENSAGENS_NOTIFICACAO, validarNotificacao } from './notificacao';

const U = '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c';
const base = { conta: '4.1.1', limite: '80', frequenciaDias: 7, usuarioId: U };

describe('validarNotificacao (US-041, UC02.20 "Desempenho")', () => {
  it('conta, limite, frequência e usuário válidos → ok, com o limite em texto decimal', () => {
    expect(validarNotificacao(base)).toEqual({ ok: true, valor: { conta: '4.1.1', limite: '80', frequenciaDias: 7, usuarioId: U } });
  });

  it('"Todas" (RN0051): nulo ou o valor do select viram conta nula', () => {
    expect(validarNotificacao({ ...base, conta: null })).toMatchObject({ ok: true, valor: { conta: null } });
    expect(validarNotificacao({ ...base, conta: CONTA_TODAS })).toMatchObject({ ok: true, valor: { conta: null } });
  });

  it('limite com vírgula decimal, sem number: "80,5" → "80.5"; dois decimais no máximo', () => {
    expect(validarNotificacao({ ...base, limite: '80,5' })).toMatchObject({ ok: true, valor: { limite: '80.5' } });
    expect(validarNotificacao({ ...base, limite: ' 999,99 ' })).toMatchObject({ ok: true, valor: { limite: '999.99' } });
    expect(validarNotificacao({ ...base, limite: '0,01' })).toMatchObject({ ok: true, valor: { limite: '0.01' } });
  });

  it.each(['0', '0,00', '1000', '999,999', '80,555', '80.555', '-5', '1e2', '', 'abc', '80,5,1', '80.5,1'])('limite fora da faixa ou do formato (%j) → erro no campo; mais de duas casas é recusado, não arredondado', (limite) => {
    expect(validarNotificacao({ ...base, limite })).toEqual({ ok: false, erros: [{ campo: 'limite', mensagem: MENSAGENS_NOTIFICACAO.LIMITE }] });
  });

  it('limite que não é texto (number) → erro, nunca convertido', () => {
    expect(validarNotificacao({ ...base, limite: 80 })).toEqual({ ok: false, erros: [{ campo: 'limite', mensagem: MENSAGENS_NOTIFICACAO.LIMITE }] });
  });

  it.each([0, 366, 1.5, -1, '0', '366', '7d', '', null])('frequência fora de 1 a 365 dias (%j) → erro no campo (RN0067)', (frequenciaDias) => {
    expect(validarNotificacao({ ...base, frequenciaDias })).toEqual({ ok: false, erros: [{ campo: 'frequenciaDias', mensagem: MENSAGENS_NOTIFICACAO.FREQUENCIA }] });
  });

  it('frequência em texto (formulário) → inteiro', () => {
    expect(validarNotificacao({ ...base, frequenciaDias: '30' })).toMatchObject({ ok: true, valor: { frequenciaDias: 30 } });
    expect(validarNotificacao({ ...base, frequenciaDias: 365 })).toMatchObject({ ok: true, valor: { frequenciaDias: 365 } });
  });

  it('usuário vazio → mensagem do A2; conta vazia ou fora do formato → erro na conta; um erro por campo', () => {
    expect(validarNotificacao({ conta: '', limite: '0', frequenciaDias: 0, usuarioId: '' })).toEqual({
      ok: false,
      erros: [
        { campo: 'conta', mensagem: MENSAGENS_NOTIFICACAO.CONTA },
        { campo: 'limite', mensagem: MENSAGENS_NOTIFICACAO.LIMITE },
        { campo: 'frequenciaDias', mensagem: MENSAGENS_NOTIFICACAO.FREQUENCIA },
        { campo: 'usuarioId', mensagem: MENSAGENS_NOTIFICACAO.USUARIO },
      ],
    });
    expect(validarNotificacao({ ...base, conta: '4.1;DROP' })).toEqual({ ok: false, erros: [{ campo: 'conta', mensagem: MENSAGENS_NOTIFICACAO.CONTA_INVALIDA }] });
    expect(validarNotificacao(null)).toMatchObject({ ok: false });
  });

  it('textos fixados pelo plano (D-P10-9)', () => {
    expect(MENSAGENS_NOTIFICACAO.USUARIO).toBe('O usuário é obrigatório.');
    expect(MENSAGENS_NOTIFICACAO.DUPLICADA).toBe('Este usuário já recebe a notificação desta conta.');
  });
});
