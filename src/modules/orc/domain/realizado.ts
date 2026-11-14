import { Dinheiro, falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { lerValor } from './planilha';

// Realizado por arquivo (US-085, parte 1; plano do P32; OxR V2). O layout é PROVISÓRIO (D-P32-1) até o GAP-PGD-006/009:
// aba Realizado, colunas Conta, Competência e Valor; a conta é a classificação do C1. Só o leitor muda quando o
// payload do Senior for definido.

export const ABA_REALIZADO = 'Realizado';
export const COLUNAS_REALIZADO = ['Conta', 'Competência', 'Valor'] as const;
export const LINHA_CABECALHO_REALIZADO = 5;
export const MAXIMO_ERROS_REALIZADO = 200;

export type LinhaArquivo = { numero: number; celulas: Readonly<Record<string, string | null>> };
/** Conta e competência ('AAAA-MM') do arquivo, com as linhas repetidas somadas (D-P32-1). */
export type ValorArquivo = { conta: string; competencia: string; valor: Dinheiro };

const COMPETENCIA_ISO = /^(\d{4})-(\d{2})(?:-\d{2})?$/; // AAAA-MM, ou a célula de data do leitor (AAAA-MM-DD)
const COMPETENCIA_TELA = /^(\d{2})\/(\d{4})$/;

/** 'AAAA-MM' de 'AAAA-MM', 'MM/AAAA' ou de uma célula de data; nulo fora do formato. */
export function lerCompetencia(celula: string | null): string | null {
  const t = celula?.trim() ?? '';
  const iso = COMPETENCIA_ISO.exec(t);
  const tela = COMPETENCIA_TELA.exec(t);
  const [ano, mes] = iso ? [iso[1]!, iso[2]!] : tela ? [tela[2]!, tela[1]!] : [null, null];
  if (!ano || !mes) return null;
  const m = Number(mes);
  return m >= 1 && m <= 12 ? `${ano}-${mes}` : null;
}

export const MENSAGENS_REALIZADO = {
  CONTA_VAZIA: 'Informe a conta.',
  COMPETENCIA_INVALIDA: 'Competência inválida. Use AAAA-MM ou MM/AAAA.',
  FORA_DA_VIGENCIA: 'Competência fora da vigência do TP.',
  VALOR_INVALIDO: 'Valor inválido. Use número com até 2 casas decimais.',
  VALOR_VAZIO: 'Informe o valor.',
  ARQUIVO_VAZIO: 'O arquivo não tem nenhuma linha de realizado.',
  COM_ERROS: 'O arquivo tem erros. Nada foi carregado.',
  MAIS_ERROS: (n: number) => `E mais ${n} erro(s) não listados.`,
} as const;

/**
 * Valida e agrega as linhas do arquivo (D-P32-1, D-P32-2): qualquer erro reprova o arquivo inteiro, com a lista dos
 * erros por linha. A conta não é conferida aqui: desconhecida ou sintética vira pendência na carga (RN_OXR_004).
 */
export function validarArquivoRealizado(linhas: readonly LinhaArquivo[], vigencia: ReadonlySet<string>): Resultado<readonly ValorArquivo[]> {
  const erros: ErroCampo[] = [];
  const somas = new Map<string, ValorArquivo>();
  const erro = (l: LinhaArquivo, coluna: string, mensagem: string) => erros.push({ campo: `linhas.${l.numero}.${coluna}`, mensagem: `Linha ${l.numero}: ${mensagem}` });
  for (const l of linhas) {
    const conta = (l.celulas['Conta'] ?? '').trim();
    const compTexto = l.celulas['Competência'] ?? null;
    const valorTexto = l.celulas['Valor'] ?? null;
    if (!conta && !compTexto?.trim() && !valorTexto?.trim()) continue; // linha em branco
    const antes = erros.length;
    if (!conta) erro(l, 'Conta', MENSAGENS_REALIZADO.CONTA_VAZIA);
    const competencia = lerCompetencia(compTexto);
    if (!competencia) erro(l, 'Competência', MENSAGENS_REALIZADO.COMPETENCIA_INVALIDA);
    else if (!vigencia.has(competencia)) erro(l, 'Competência', MENSAGENS_REALIZADO.FORA_DA_VIGENCIA);
    const valor = lerValor(valorTexto);
    if (valor === null) erro(l, 'Valor', MENSAGENS_REALIZADO.VALOR_VAZIO);
    else if (valor === 'INVALIDO') erro(l, 'Valor', MENSAGENS_REALIZADO.VALOR_INVALIDO);
    if (erros.length > antes || !competencia || valor === null || valor === 'INVALIDO') continue;
    const chave = `${conta}|${competencia}`;
    const atual = somas.get(chave);
    somas.set(chave, { conta, competencia, valor: atual ? atual.valor.somar(valor) : valor });
  }
  if (erros.length > 0) {
    return falha([
      { campo: '_', mensagem: MENSAGENS_REALIZADO.COM_ERROS },
      ...erros.slice(0, MAXIMO_ERROS_REALIZADO),
      ...(erros.length > MAXIMO_ERROS_REALIZADO ? [{ campo: '_', mensagem: MENSAGENS_REALIZADO.MAIS_ERROS(erros.length - MAXIMO_ERROS_REALIZADO) }] : []),
    ]);
  }
  if (somas.size === 0) return falha([{ campo: '_', mensagem: MENSAGENS_REALIZADO.ARQUIVO_VAZIO }]);
  return ok([...somas.values()]);
}

/** A primeira competência aberta posterior à origem (RN_OXR_006, D-P32-5). */
export function competenciaDeLancamento(origem: string, fechadas: ReadonlySet<string>): string {
  let [ano, mes] = origem.split('-').map(Number) as [number, number];
  for (;;) {
    mes += 1;
    if (mes > 12) [ano, mes] = [ano + 1, 1];
    const c = `${ano}-${String(mes).padStart(2, '0')}`;
    if (!fechadas.has(c)) return c;
  }
}

/** 'AAAA-MM' para a data do dia 1 (UTC), como o banco guarda a competência. */
export const competenciaParaData = (c: string): Date => new Date(`${c}-01T00:00:00Z`);
