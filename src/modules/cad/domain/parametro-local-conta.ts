import { falha, ok, type ErroCampo, type Percentual, type Resultado } from '@/shared/kernel';
import { percentualDoTexto } from './parametros';
import type { FaixasSemaforo } from './semaforo';

// Parâmetros locais da conta analítica (US-045; RF_PLA_REQ_003, C7, C27): a natureza OPEX/CAPEX e,
// opcionalmente, faixas do semáforo próprias. Sem faixas próprias, valem as do exercício. As faixas
// seguem a mesma regra das do exercício (RN_PLA_006): de 0 a 999%, em ordem verde < amarelo < laranja.

export const NATUREZAS_CONTA = ['OPEX', 'CAPEX'] as const;
export type NaturezaConta = (typeof NATUREZAS_CONTA)[number];

export type EntradaParametroLocal = {
  natureza: string | null;
  /** null: usa as faixas do exercício. */
  semaforo: { verdeAte: string; amareloAte: string; laranjaAte: string } | null;
};

export type ParametroLocalValidado = { natureza: NaturezaConta | null; semaforo: FaixasSemaforo | null };

function faixa(campo: string, texto: string, erros: ErroCampo[]): Percentual | null {
  const p = percentualDoTexto(texto);
  if (p === null) {
    erros.push({ campo, mensagem: 'Informe um percentual com até 4 casas decimais.' });
    return null;
  }
  const pontos = p.comoFracao().times(100);
  if (pontos.lt(0) || pontos.gt(999)) {
    erros.push({ campo, mensagem: 'O percentual deve ficar entre 0 e 999.' });
    return null;
  }
  return p;
}

export function validarParametroLocal(e: EntradaParametroLocal): Resultado<ParametroLocalValidado> {
  const erros: ErroCampo[] = [];
  const natureza = e.natureza === null || e.natureza === '' ? null : e.natureza;
  if (natureza !== null && !(NATUREZAS_CONTA as readonly string[]).includes(natureza)) {
    erros.push({ campo: 'natureza', mensagem: 'Escolha OPEX, CAPEX ou nenhuma.' });
  }
  let semaforo: FaixasSemaforo | null = null;
  if (e.semaforo !== null) {
    const verde = faixa('semaforo.verdeAte', e.semaforo.verdeAte, erros);
    const amarelo = faixa('semaforo.amareloAte', e.semaforo.amareloAte, erros);
    const laranja = faixa('semaforo.laranjaAte', e.semaforo.laranjaAte, erros);
    if (verde && amarelo && laranja) {
      if (!(verde.comoFracao().lt(amarelo.comoFracao()) && amarelo.comoFracao().lt(laranja.comoFracao()))) {
        erros.push({ campo: 'semaforo', mensagem: 'As faixas do semáforo devem estar em ordem: verde < amarelo < laranja.' });
      } else {
        semaforo = { verdeAte: verde, amareloAte: amarelo, laranjaAte: laranja };
      }
    }
  }
  if (erros.length > 0) return falha(erros);
  return ok({ natureza: natureza as NaturezaConta | null, semaforo });
}

/** As faixas que valem para a conta: as próprias, se houver; senão, as do exercício. */
export const faixasDaConta = (proprias: FaixasSemaforo | null, doExercicio: FaixasSemaforo): FaixasSemaforo => proprias ?? doExercicio;
