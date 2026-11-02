// Lógica pura da tela de importação de estrutura (US-043 parte 4; plano do P4, Task 7a), sem React.
import type { ErroCampo } from '@/shared/kernel';
import type { ErroLinha } from '../domain/plano-contas';

export const LIMITE_ERROS_TELA = 200;
export const INTERVALO_CONSULTA_MS = 2000;
// 10 minutos de acompanhamento; depois, a tela para de perguntar e avisa.
export const MAX_CONSULTAS = 300;

export type Resposta<T> = { ok: true; valor: T } | { ok: false; erros: readonly ErroCampo[] };
export type EstadoCargaTela = {
  cargaId: string;
  situacao: 'PENDENTE' | 'PROCESSANDO' | 'CONCLUIDA' | 'FALHOU';
  linhas: number;
  incluidas: number | null;
  alteradas: number | null;
  inativadas: number | null;
  inalteradas: number | null;
  avisos: readonly ErroLinha[];
  erros: readonly ErroLinha[];
  erro: string | null;
};

const CAMPO_LINHA = /^linhas\.(\d+)(?:\.(.+))?$/;

/** Separa os erros da ação: `arquivo`, por linha (`linhas.<n>.<coluna>`) e gerais (o resto). */
export function separarErros(erros: readonly ErroCampo[]): { arquivo: string[]; linhas: ErroLinha[]; gerais: string[] } {
  const arquivo: string[] = [];
  const linhas: ErroLinha[] = [];
  const gerais: string[] = [];
  for (const e of erros) {
    const m = CAMPO_LINHA.exec(e.campo);
    if (m) linhas.push({ linha: Number(m[1]), ...(m[2] ? { coluna: m[2] } : {}), mensagem: e.mensagem });
    else if (e.campo === 'arquivo') arquivo.push(e.mensagem);
    else gerais.push(e.mensagem);
  }
  return { arquivo, linhas, gerais };
}

/** Os primeiros `limite` itens e o total, para a tela não montar milhares de linhas. */
export function resumir<T>(itens: readonly T[], limite = LIMITE_ERROS_TELA): { mostrados: readonly T[]; total: number } {
  return { mostrados: itens.slice(0, limite), total: itens.length };
}

const n = (v: number | null) => v ?? 0;

/** Texto da situação do lote, para o role="status". */
export function textoSituacao(e: EstadoCargaTela): string {
  if (e.situacao === 'CONCLUIDA') {
    return `Plano de contas importado: ${n(e.incluidas)} incluídas, ${n(e.alteradas)} alteradas, ${n(e.inativadas)} inativadas, ${n(e.inalteradas)} sem alteração.`;
  }
  if (e.situacao === 'FALHOU') return 'A importação falhou. Nada foi gravado; confira os erros abaixo.';
  return e.situacao === 'PENDENTE' ? 'Arquivo recebido. A importação vai começar em instantes.' : `Importando ${e.linhas} linhas…`;
}

export type Acompanhamento =
  | { tipo: 'estado'; estado: EstadoCargaTela }
  | { tipo: 'erro'; mensagem: string }
  | { tipo: 'esgotado' };

/**
 * Consulta o lote na hora e a cada 2 s até CONCLUIDA ou FALHOU (ou até `cancelado()`), avisando
 * cada mudança. Resposta de erro ou lote sumido encerram com a mensagem.
 */
export async function acompanharCarga(opcoes: {
  cargaId: string;
  consultar: (e: { cargaId: string }) => Promise<Resposta<EstadoCargaTela | null>>;
  aoAtualizar: (a: Acompanhamento) => void;
  cancelado?: () => boolean;
  esperar?: (ms: number) => Promise<void>;
  maxConsultas?: number;
}): Promise<void> {
  const esperar = opcoes.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const cancelado = opcoes.cancelado ?? (() => false);
  for (let i = 0; i < (opcoes.maxConsultas ?? MAX_CONSULTAS); i++) {
    if (i > 0) await esperar(INTERVALO_CONSULTA_MS);
    if (cancelado()) return;
    const r = await opcoes.consultar({ cargaId: opcoes.cargaId });
    if (cancelado()) return;
    if (!r.ok) return opcoes.aoAtualizar({ tipo: 'erro', mensagem: r.erros[0]?.mensagem ?? 'Não foi possível consultar a importação.' });
    if (r.valor === null) return opcoes.aoAtualizar({ tipo: 'erro', mensagem: 'A importação não foi encontrada.' });
    opcoes.aoAtualizar({ tipo: 'estado', estado: r.valor });
    if (r.valor.situacao === 'CONCLUIDA' || r.valor.situacao === 'FALHOU') return;
  }
  opcoes.aoAtualizar({ tipo: 'esgotado' });
}
