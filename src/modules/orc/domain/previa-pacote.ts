import { Dinheiro, ErroDominio, Percentual } from '@/shared/kernel';
import { calcularPacote } from './pacote';
import { valorDaTela } from './valor-tela';

// Prévia do pacote no formulário (D-P11-6): a mesma função pura do servidor (calcularPacote), com o
// que está digitado na tela. Sem I/O: roda no navegador. O valor gravado é sempre o do servidor.
export type CamposPrevia = {
  quantidade: string;
  valorUnitario: string;
  corrigirIpca: string; // 'Sim' | 'Não'
  distribuicao: string; // 'Mensal' | 'Pontual'
  mesOcorrencia: string;
};
export type Previa =
  | { ok: true; valorAnual: Dinheiro; meses: readonly Dinheiro[]; mesOcorrencia: number | null; ipcaAplicado: Percentual | null }
  | { ok: false; motivo: string };

// [PROVISÓRIOS] (GAP-ORC-004)
export const MOTIVOS_PREVIA = {
  INCOMPLETO: 'Preencha a quantidade, o valor unitário e a distribuição para ver a prévia.',
  SEM_MES: 'Escolha o mês do pacote pontual para ver a prévia.',
  SEM_IPCA: 'O exercício ainda não tem o IPCA nas premissas: a prévia com correção fica indisponível.',
} as const;

const INTEIRO = /^\d+$/;

export function previaPacote(c: CamposPrevia, ipcaPontos: string | null, quantidadeMaxima: number): Previa {
  const q = c.quantidade.trim();
  const quantidade = INTEIRO.test(q) ? Number(q) : NaN;
  const distribuicao = c.distribuicao === 'Mensal' ? 'MENSAL' : c.distribuicao === 'Pontual' ? 'PONTUAL' : null;
  let valorUnitario: Dinheiro | null = null;
  try {
    const t = valorDaTela(c.valorUnitario);
    valorUnitario = /^\d+(\.\d{1,2})?$/.test(t) ? Dinheiro.de(t) : null;
  } catch (erro) {
    if (!(erro instanceof ErroDominio)) throw erro;
  }
  if (!(quantidade >= 1 && quantidade <= quantidadeMaxima) || !valorUnitario || valorUnitario.ehZero() || !distribuicao) {
    return { ok: false, motivo: MOTIVOS_PREVIA.INCOMPLETO };
  }
  const m = c.mesOcorrencia.trim();
  const mes = INTEIRO.test(m) && Number(m) >= 1 && Number(m) <= 12 ? Number(m) : null;
  if (distribuicao === 'PONTUAL' && mes === null) return { ok: false, motivo: MOTIVOS_PREVIA.SEM_MES };
  const corrigirIpca = c.corrigirIpca === 'Sim';
  if (corrigirIpca && ipcaPontos === null) return { ok: false, motivo: MOTIVOS_PREVIA.SEM_IPCA };
  const ipca = ipcaPontos === null ? Percentual.dePontos('0') : Percentual.dePontos(ipcaPontos);
  const mesOcorrencia = distribuicao === 'PONTUAL' ? mes : null;
  const r = calcularPacote({ quantidade, valorUnitario, corrigirIpca, distribuicao, mesOcorrencia }, ipca);
  return { ok: true, valorAnual: r.valorAnual, meses: r.meses, mesOcorrencia, ipcaAplicado: corrigirIpca ? ipca : null };
}
