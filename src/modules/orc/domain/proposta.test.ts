import { describe, expect, it } from 'vitest';
import { MENSAGENS_ORC as M } from './mensagens';
import { nomeDaUnidade, ROTULO_SITUACAO_PROPOSTA, validarCapa, type CapaValidada } from './proposta';

// Capa da proposta de TP (US-065; plano do P17, Task 1): UC 3.05 E1/E2, RN_TP_002 e D-P17-4.
const valida = {
  tipo: 'TERMO_PARCERIA',
  numero: 'TP-001/2027',
  objeto: 'Objeto de exemplo do TP',
  parceiro: 'Parceiro Exemplo',
  inicio: '2027-01-01',
  fim: '2027-12-31',
  categoria: 'CONSOLIDADA',
  cc: '9.1',
};

const erros = (bruto: Record<string, unknown>) => {
  const r = validarCapa(bruto);
  return r.ok ? [] : r.erros;
};

describe('validarCapa', () => {
  it('capa válida: textos cortados e parceiro vazio vira nulo', () => {
    expect(validarCapa({ ...valida, numero: '  TP-001/2027  ', objeto: ' Objeto ', parceiro: '   ' })).toEqual({
      ok: true,
      valor: { ...valida, numero: 'TP-001/2027', objeto: 'Objeto', parceiro: null } as CapaValidada,
    });
    expect(validarCapa({ ...valida, parceiro: undefined })).toMatchObject({ ok: true, valor: { parceiro: null } });
  });

  it('E1: campos obrigatórios em branco → a mensagem completa e cada campo marcado', () => {
    expect(erros({ parceiro: 'x' })).toEqual([
      { campo: '_', mensagem: M.PROPOSTA_OBRIGATORIOS },
      ...['tipo', 'numero', 'objeto', 'inicio', 'fim', 'categoria', 'cc'].map((campo) => ({ campo, mensagem: M.PROPOSTA_CAMPO_OBRIGATORIO })),
    ]);
    expect(M.PROPOSTA_OBRIGATORIOS).toContain('Tipo, Número do TP, Nome/Objeto, Data de Início, Data de Término, Categoria e Centro de Custo');
    // Só espaços conta como em branco.
    expect(erros({ ...valida, objeto: '   ' })).toEqual([
      { campo: '_', mensagem: M.PROPOSTA_OBRIGATORIOS },
      { campo: 'objeto', mensagem: M.PROPOSTA_CAMPO_OBRIGATORIO },
    ]);
  });

  it('E2 (RN_TP_002): término com menos de 30 dias depois do início, igual ou antes → recusado; 30 dias exatos passa', () => {
    const vigencia = [{ campo: 'fim', mensagem: M.PROPOSTA_VIGENCIA_CURTA }];
    expect(erros({ ...valida, inicio: '2027-01-01', fim: '2027-01-30' })).toEqual(vigencia);
    expect(erros({ ...valida, inicio: '2027-01-01', fim: '2027-01-01' })).toEqual(vigencia);
    expect(erros({ ...valida, inicio: '2027-03-01', fim: '2027-01-01' })).toEqual(vigencia);
    expect(validarCapa({ ...valida, inicio: '2027-01-01', fim: '2027-01-31' }).ok).toBe(true);
    // Fevereiro e virada de ano contam em dias civis.
    expect(validarCapa({ ...valida, inicio: '2028-02-01', fim: '2028-03-02' }).ok).toBe(true);
    expect(erros({ ...valida, inicio: '2028-02-01', fim: '2028-03-01' })).toEqual(vigencia);
    expect(validarCapa({ ...valida, inicio: '2027-12-15', fim: '2028-01-14' }).ok).toBe(true);
  });

  it('datas fora do formato ou inexistentes → inválidas', () => {
    expect(erros({ ...valida, inicio: '01/01/2027' })).toEqual([{ campo: 'inicio', mensagem: M.PROPOSTA_DATA_INVALIDA }]);
    expect(erros({ ...valida, fim: '2027-02-30' })).toEqual([{ campo: 'fim', mensagem: M.PROPOSTA_DATA_INVALIDA }]);
  });

  it('tipo e categoria fora do domínio', () => {
    expect(erros({ ...valida, tipo: 'CONVENIO', categoria: 'consolidada' })).toEqual([
      { campo: 'tipo', mensagem: M.PROPOSTA_TIPO_INVALIDO },
      { campo: 'categoria', mensagem: M.PROPOSTA_CATEGORIA_INVALIDA },
    ]);
  });

  it('limites: objeto até 500, parceiro até 200 e número até 60 caracteres (contados como o char_length)', () => {
    expect(validarCapa({ ...valida, objeto: '🚀'.repeat(500) }).ok).toBe(true);
    expect(erros({ ...valida, objeto: 'a'.repeat(501) })).toEqual([{ campo: 'objeto', mensagem: M.PROPOSTA_OBJETO_LONGO(500) }]);
    expect(erros({ ...valida, parceiro: 'a'.repeat(201) })).toEqual([{ campo: 'parceiro', mensagem: M.PROPOSTA_PARCEIRO_LONGO(200) }]);
    expect(erros({ ...valida, numero: 'a'.repeat(61) })).toEqual([{ campo: 'numero', mensagem: M.PROPOSTA_NUMERO_LONGO(60) }]);
  });

  it('valores que não são texto valem como em branco', () => {
    expect(erros({ ...valida, numero: 123 })).toEqual([
      { campo: '_', mensagem: M.PROPOSTA_OBRIGATORIOS },
      { campo: 'numero', mensagem: M.PROPOSTA_CAMPO_OBRIGATORIO },
    ]);
  });
});

describe('nomeDaUnidade', () => {
  it('o objeto cortado em 120 caracteres (D-P17-2)', () => {
    expect(nomeDaUnidade('Objeto curto')).toBe('Objeto curto');
    expect([...nomeDaUnidade('🚀'.repeat(130))].length).toBe(120);
  });
});

describe('ROTULO_SITUACAO_PROPOSTA', () => {
  it('as situações da §6.2', () => {
    expect(ROTULO_SITUACAO_PROPOSTA).toEqual({
      RASCUNHO: 'Rascunho',
      EM_ELABORACAO: 'Em Elaboração',
      EM_APROVACAO: 'Em Aprovação',
      OFICIALIZADO: 'Oficializado',
      ENCERRADO: 'Encerrado',
    });
  });
});
