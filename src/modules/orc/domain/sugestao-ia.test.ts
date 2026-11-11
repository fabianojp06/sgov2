import { describe, expect, it } from 'vitest';
import { deveMarcarSugestao, usarSugestaoNoSeletor } from './sugestao-ia';

// Marca da sugestão aceita (D-P14-3).
describe('deveMarcarSugestao', () => {
  const valores = (justificativa: string, prioridade = 'Importante', conta = '4.1.1.5.005', cc = '4.3.0') => ({ justificativa, prioridade, conta, cc });

  it('sem nada aceito: não marca', () => {
    expect(deveMarcarSugestao({}, valores('Texto qualquer da justificativa'))).toBe(false);
  });

  it('marca depois de "Usar este texto" e some quando o texto muda', () => {
    const aceitas = { justificativa: 'Texto sugerido pela IA.' };
    expect(deveMarcarSugestao(aceitas, valores('Texto sugerido pela IA.'))).toBe(true);
    expect(deveMarcarSugestao(aceitas, valores('Texto sugerido pela IA, editado.'))).toBe(false);
  });

  it('ignora CRLF/LF e os espaços nas pontas', () => {
    const aceitas = { justificativa: 'Linha um.\nLinha dois.' };
    expect(deveMarcarSugestao(aceitas, valores('  Linha um.\r\nLinha dois.  '))).toBe(true);
    expect(deveMarcarSugestao({ justificativa: 'A\r\nB ' }, valores('A\nB'))).toBe(true);
  });

  it('prioridade aceita: marca enquanto continua a mesma', () => {
    const aceitas = { prioridade: 'Essencial' };
    expect(deveMarcarSugestao(aceitas, valores('Outro texto da justificativa', 'Essencial'))).toBe(true);
    expect(deveMarcarSugestao(aceitas, valores('Outro texto da justificativa', 'Desejável'))).toBe(false);
  });

  it('basta um dos campos continuar com o valor aceito', () => {
    const aceitas = { justificativa: 'Texto da IA aceito.', prioridade: 'Essencial' };
    expect(deveMarcarSugestao(aceitas, valores('Mudei o texto todo.', 'Essencial'))).toBe(true);
    expect(deveMarcarSugestao(aceitas, valores('Texto da IA aceito.', 'Desejável'))).toBe(true);
    expect(deveMarcarSugestao(aceitas, valores('Mudei o texto todo.', 'Desejável'))).toBe(false);
  });

  it('conta ou CC aceitos (US-062): marca enquanto o seletor continua com o valor aceito', () => {
    const conta = { conta: '4.1.1.5.028' };
    expect(deveMarcarSugestao(conta, valores('Outro texto da justificativa', 'Importante', '4.1.1.5.028'))).toBe(true);
    expect(deveMarcarSugestao(conta, valores('Outro texto da justificativa', 'Importante', '4.1.1.5.005'))).toBe(false);
    const cc = { cc: '4.3.2.11' };
    expect(deveMarcarSugestao(cc, valores('Outro texto da justificativa', 'Importante', '4.1.1.5.005', '4.3.2.11'))).toBe(true);
    expect(deveMarcarSugestao(cc, valores('Outro texto da justificativa', 'Importante', '4.1.1.5.005', '4.3.0'))).toBe(false);
    // Voltar ao valor aceito marca de novo.
    expect(deveMarcarSugestao({ ...conta, ...cc }, valores('Outro texto da justificativa', 'Importante', '4.1.1.5.005', '4.3.2.11'))).toBe(true);
  });
});

// "Usar esta conta" e "Usar este CC" (US-062): a troca do seletor e a marca sugestaoIa.
describe('usarSugestaoNoSeletor', () => {
  const CONTAS = { opcoes: ['', '4.1.1.5.005', '4.1.1.5.028'], atual: '4.1.1.5.005' };
  const CCS = { opcoes: ['4.3.0', '4.3.2.11'], atual: '4.3.0' };
  const marca = (aceitas: Parameters<typeof deveMarcarSugestao>[0], conta: string, cc: string) =>
    deveMarcarSugestao(aceitas, { justificativa: 'Texto digitado pela pessoa', prioridade: 'Importante', conta, cc });

  it('"Usar esta conta" troca o seletor e faz aparecer a marca', () => {
    const r = usarSugestaoNoSeletor({}, 'conta', '4.1.1.5.028', CONTAS);
    expect(r).toEqual({ valor: '4.1.1.5.028', aceitas: { conta: '4.1.1.5.028' } });
    expect(marca(r!.aceitas, r!.valor, CCS.atual)).toBe(true);
    // A pessoa troca a conta de novo: a marca some.
    expect(marca(r!.aceitas, '4.1.1.5.005', CCS.atual)).toBe(false);
  });

  it('"Usar este CC" troca o seletor e faz aparecer a marca, mantendo o que já foi aceito', () => {
    const r = usarSugestaoNoSeletor({ justificativa: 'Outro texto' }, 'cc', '4.3.2.11', CCS);
    expect(r).toEqual({ valor: '4.3.2.11', aceitas: { justificativa: 'Outro texto', cc: '4.3.2.11' } });
    expect(marca(r!.aceitas, CONTAS.atual, r!.valor)).toBe(true);
  });

  it('a sugerida já era a escolhida: o seletor fica, e não há marca', () => {
    const r = usarSugestaoNoSeletor({}, 'conta', '4.1.1.5.005', CONTAS);
    expect(r).toEqual({ valor: '4.1.1.5.005', aceitas: {} });
    expect(marca(r!.aceitas, r!.valor, CCS.atual)).toBe(false);
  });

  it('valor fora das opções do seletor: ignorado, nada muda', () => {
    expect(usarSugestaoNoSeletor({}, 'conta', '4.1.1.1.001', CONTAS)).toBeNull();
    expect(usarSugestaoNoSeletor({}, 'cc', '4.4', CCS)).toBeNull();
  });
});
