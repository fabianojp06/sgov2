import { describe, expect, it } from 'vitest';
import { Dinheiro, Percentual } from '@/shared/kernel';
import { calcularPacote } from './pacote';
import { MOTIVOS_PREVIA, previaPacote, type CamposPrevia } from './previa-pacote';

// Prévia do formulário de pacotes (D-P11-6; Review Focus 3): igual ao que o servidor grava.
const campos = (extra: Partial<CamposPrevia> = {}): CamposPrevia => ({ quantidade: '3', valorUnitario: '1.234,57', corrigirIpca: 'Sim', distribuicao: 'Mensal', mesOcorrencia: '', ...extra });
const texto = (xs: readonly Dinheiro[]) => xs.map((x) => x.paraString());

describe('previaPacote', () => {
  it('mensal com IPCA: igual a calcularPacote, com os centavos que sobram em dezembro', () => {
    const p = previaPacote(campos(), '4.5000', 9999);
    const servidor = calcularPacote({ quantidade: 3, valorUnitario: Dinheiro.de('1234.57'), corrigirIpca: true, distribuicao: 'MENSAL', mesOcorrencia: null }, Percentual.dePontos('4.5'));
    if (!p.ok) throw new Error(p.motivo);
    expect(p.valorAnual.paraString()).toBe('3870.38');
    expect(texto(p.meses)).toEqual(texto(servidor.meses));
    expect(texto(p.meses)).toEqual([...Array(11).fill('322.53'), '322.55']);
    expect(Dinheiro.somarTodos(p.meses).paraString()).toBe('3870.38');
    expect(p.ipcaAplicado?.paraString()).toBe('4.5000');
  });

  it('pontual sem IPCA: o anual no mês; o IPCA nulo não importa sem correção', () => {
    const p = previaPacote(campos({ distribuicao: 'Pontual', mesOcorrencia: '7', corrigirIpca: 'Não', quantidade: '2', valorUnitario: '500' }), null, 9999);
    if (!p.ok) throw new Error(p.motivo);
    expect(texto(p.meses)).toEqual(Array.from({ length: 12 }, (_, i) => (i === 6 ? '1000.00' : '0.00')));
    expect(p).toMatchObject({ mesOcorrencia: 7, ipcaAplicado: null });
  });

  it('incompleto, pontual sem mês e IPCA nulo com correção: sem prévia, com o motivo', () => {
    expect(previaPacote(campos({ quantidade: '' }), '4.5', 9999)).toEqual({ ok: false, motivo: MOTIVOS_PREVIA.INCOMPLETO });
    expect(previaPacote(campos({ quantidade: '10000' }), '4.5', 9999)).toEqual({ ok: false, motivo: MOTIVOS_PREVIA.INCOMPLETO });
    expect(previaPacote(campos({ valorUnitario: '7.500,001' }), '4.5', 9999)).toEqual({ ok: false, motivo: MOTIVOS_PREVIA.INCOMPLETO });
    expect(previaPacote(campos({ valorUnitario: '0' }), '4.5', 9999)).toEqual({ ok: false, motivo: MOTIVOS_PREVIA.INCOMPLETO });
    expect(previaPacote(campos({ distribuicao: 'Pontual' }), '4.5', 9999)).toEqual({ ok: false, motivo: MOTIVOS_PREVIA.SEM_MES });
    expect(previaPacote(campos(), null, 9999)).toEqual({ ok: false, motivo: MOTIVOS_PREVIA.SEM_IPCA });
  });
});
