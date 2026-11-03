import { Dinheiro, falha, ok, Percentual, type Resultado } from '@/shared/kernel';
import { MENSAGENS_ORC } from './mensagens';
import { contarCaracteres } from './texto';

// Teto, uso e resultado do exercício (US-059; spec §6.6). Receita confirmada é o rateio líquido
// confirmado (ISS "a definir", GAP-ORC-007: líquido = rateio); a prevista não entra no saldo nem
// no teto. Teto padrão = receita confirmada do ano; o manual o substitui.
export type Painel = {
  receitaConfirmadaMes: readonly Dinheiro[];
  receitaPrevistaMes: readonly Dinheiro[];
  despesasMes: readonly Dinheiro[];
  resultadoMes: readonly Dinheiro[];
  resultadoAno: Dinheiro;
  tetoPadrao: Dinheiro;
  tetoManual: Dinheiro | null;
  tetoEfetivo: Dinheiro;
  orcado: Dinheiro;
  uso: Percentual | null; // orçado ÷ teto efetivo × 100; nulo com teto zero
  saldo: Dinheiro;
};

type ReceitaPainel = { situacao: 'CONFIRMADO' | 'PREVISTO'; meses: readonly Dinheiro[] };

const porMes = (series: readonly (readonly Dinheiro[])[]) => Array.from({ length: 12 }, (_, i) => Dinheiro.somarTodos(series.map((s) => s[i]!)));

export function calcularPainel(despesasMes: readonly Dinheiro[], receitas: readonly ReceitaPainel[], tetoManual: Dinheiro | null): Painel {
  const receitaConfirmadaMes = porMes(receitas.filter((r) => r.situacao === 'CONFIRMADO').map((r) => r.meses));
  const receitaPrevistaMes = porMes(receitas.filter((r) => r.situacao === 'PREVISTO').map((r) => r.meses));
  const resultadoMes = receitaConfirmadaMes.map((r, i) => r.subtrair(despesasMes[i]!));
  const tetoPadrao = Dinheiro.somarTodos(receitaConfirmadaMes);
  const tetoEfetivo = tetoManual ?? tetoPadrao;
  const orcado = Dinheiro.somarTodos(despesasMes);
  return {
    receitaConfirmadaMes,
    receitaPrevistaMes,
    despesasMes,
    resultadoMes,
    resultadoAno: Dinheiro.somarTodos(resultadoMes),
    tetoPadrao,
    tetoManual,
    tetoEfetivo,
    orcado,
    uso: Percentual.razao(orcado, tetoEfetivo),
    saldo: tetoEfetivo.subtrair(orcado),
  };
}

// Teto manual (D-P6-2): maior que zero; acima da receita confirmada, só com justificativa de 15
// caracteres ou mais (como a rejeição, C36). null limpa o teto manual (volta ao padrão).
export function validarTeto(
  valor: Dinheiro | null,
  justificativa: string | null,
  receitaConfirmada: Dinheiro,
): Resultado<{ valor: Dinheiro | null; justificativa: string | null }> {
  if (valor === null) return ok({ valor: null, justificativa: null });
  if (valor.ehZero() || valor.ehNegativo()) return falha([{ campo: 'teto', mensagem: MENSAGENS_ORC.TETO_ZERO }]);
  const texto = (justificativa ?? '').trim();
  if (valor.comparar(receitaConfirmada) > 0) {
    if (contarCaracteres(texto) < 15) return falha([{ campo: 'justificativa', mensagem: MENSAGENS_ORC.TETO_JUSTIFICATIVA }]);
    return ok({ valor, justificativa: texto });
  }
  return ok({ valor, justificativa: texto === '' ? null : texto });
}
