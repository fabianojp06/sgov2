// Lógica pura da tela de importação de estrutura (US-043 parte 4; plano do P4, Task 7a), sem React:
// o redutor do estado da tela e o acompanhamento do lote.
import type { ErroCampo } from '@/shared/kernel';
import type { ErroLinha } from '../domain/plano-contas';

export const LIMITE_ERROS_TELA = 200;
export const INTERVALO_CONSULTA_MS = 2000;
// 10 minutos de acompanhamento; depois, a tela para de perguntar e avisa.
export const MAX_CONSULTAS = 300;

export const MSG_FALHA_ENVIO = 'Não foi possível enviar o arquivo. Confira a conexão e tente de novo.';
export const MSG_FALHA_CONSULTA = 'Não foi possível acompanhar a importação. Recarregue a tela para conferir o resultado.';
export const MSG_ESGOTADO = 'A importação continua em andamento. Consulte o plano de contas mais tarde para ver o resultado.';

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
  if (e.situacao === 'FALHOU') return `A importação falhou e nada foi gravado.${e.erros.length > 0 ? ' Confira os erros abaixo.' : ''}`;
  return e.situacao === 'PENDENTE' ? 'Arquivo recebido. A importação vai começar em instantes.' : `Importando ${e.linhas} linhas…`;
}

export type Acompanhamento =
  | { tipo: 'estado'; estado: EstadoCargaTela }
  | { tipo: 'erro'; mensagem: string }
  | { tipo: 'esgotado' };

/**
 * Consulta o lote na hora e a cada 2 s até CONCLUIDA ou FALHOU (ou até `cancelado()`), avisando
 * cada mudança. Resposta de erro, lote sumido ou falha da própria consulta encerram com a mensagem.
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
    let r: Resposta<EstadoCargaTela | null>;
    try {
      r = await opcoes.consultar({ cargaId: opcoes.cargaId });
    } catch {
      // Rede, reinício do servidor ou deploy: a tela não pode ficar presa esperando (spec §5).
      if (!cancelado()) opcoes.aoAtualizar({ tipo: 'erro', mensagem: MSG_FALHA_CONSULTA });
      return;
    }
    if (cancelado()) return;
    if (!r.ok) return opcoes.aoAtualizar({ tipo: 'erro', mensagem: r.erros[0]?.mensagem ?? MSG_FALHA_CONSULTA });
    if (r.valor === null) return opcoes.aoAtualizar({ tipo: 'erro', mensagem: 'A importação não foi encontrada.' });
    opcoes.aoAtualizar({ tipo: 'estado', estado: r.valor });
    if (r.valor.situacao === 'CONCLUIDA' || r.valor.situacao === 'FALHOU') return;
  }
  opcoes.aoAtualizar({ tipo: 'esgotado' });
}

// Estado da tela: o que mostrar e se o botão pode ser usado.
export type EstadoTela = {
  fase: 'ocioso' | 'enviando' | 'acompanhando' | 'fim';
  cargaId: string | null;
  erroArquivo: readonly string[];
  gerais: readonly string[];
  errosLinha: readonly ErroLinha[];
  avisos: readonly ErroLinha[];
  lote: EstadoCargaTela | null;
  aviso: string | null;
};

export const TELA_INICIAL: EstadoTela = { fase: 'ocioso', cargaId: null, erroArquivo: [], gerais: [], errosLinha: [], avisos: [], lote: null, aviso: null };

export type EventoTela =
  | { tipo: 'enviar' }
  | { tipo: 'arquivoRecusado'; mensagem: string }
  | { tipo: 'resposta'; resposta: Resposta<{ cargaId: string; avisos: readonly ErroLinha[] }> }
  | { tipo: 'falhaEnvio' }
  | Acompanhamento;

export function reduzirTela(s: EstadoTela, e: EventoTela): EstadoTela {
  switch (e.tipo) {
    case 'enviar':
      return { ...TELA_INICIAL, fase: 'enviando' };
    case 'arquivoRecusado':
      return { ...TELA_INICIAL, erroArquivo: [e.mensagem] };
    case 'falhaEnvio':
      return { ...TELA_INICIAL, gerais: [MSG_FALHA_ENVIO] };
    case 'resposta': {
      if (e.resposta.ok) return { ...TELA_INICIAL, fase: 'acompanhando', cargaId: e.resposta.valor.cargaId, avisos: e.resposta.valor.avisos };
      const erros = separarErros(e.resposta.erros);
      return { ...TELA_INICIAL, erroArquivo: erros.arquivo, errosLinha: erros.linhas, gerais: erros.gerais };
    }
    case 'estado': {
      const lote = e.estado;
      if (lote.situacao === 'FALHOU') return { ...s, fase: 'fim', lote, errosLinha: lote.erros, gerais: lote.erro ? [lote.erro] : [] };
      // Os avisos do lote incluem os da R5 (reduzido que mudou de conta, inativação), que só o worker conhece.
      if (lote.situacao === 'CONCLUIDA') return { ...s, fase: 'fim', lote, avisos: lote.avisos };
      return { ...s, lote };
    }
    case 'erro':
      return { ...s, fase: 'fim', gerais: [e.mensagem] };
    case 'esgotado':
      return { ...s, fase: 'fim', aviso: MSG_ESGOTADO };
  }
}

/** O botão "Importar" fica bloqueado só durante o envio e o acompanhamento. */
export const podeEnviar = (s: EstadoTela) => s.fase === 'ocioso' || s.fase === 'fim';

/** Texto do role="status": o aviso de esgotado tem prioridade sobre a situação do lote. */
export function textoStatus(s: EstadoTela): string {
  if (s.aviso) return s.aviso;
  if (s.lote) return textoSituacao(s.lote);
  return s.fase === 'enviando' ? 'Enviando o arquivo…' : '';
}
