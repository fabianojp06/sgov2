import { describe, expect, it } from 'vitest';
import { deveMarcarSugestao } from './sugestao-ia';

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
