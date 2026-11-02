import type { Nivel, TipoCentroCusto } from './estrutura';
import type { ErroLinha, LinhaLida } from './plano-contas';

// Validação do plano de centros de custo importado (US-046; spec §6.1a; plano do P4, Task 5 e R17).
// Pura; o saneamento da marca é injetado.

/** Layout da minuta (cabeçalho achado pela célula "Classificação" nas 10 primeiras linhas). */
export const COLUNAS_CENTROS_CUSTO = [
  'Classificação',
  'Código reduzido',
  'Descrição (original)',
  'Descrição sugerida',
  'Nível',
  'Classificação pai',
  'Tipo',
  'Aceita lançamento',
] as const;

export type LinhaCentroCustoValidada = {
  linha: number;
  classificacao: string;
  codigoReduzido: string;
  /** A descrição sugerida; a original fica em `descricaoOriginal` (§6.1a). */
  descricao: string;
  descricaoOriginal: string | null;
  nivel: Nivel;
  tipo: TipoCentroCusto;
  classificacaoPai: string | null;
  deGestao: boolean;
};

export type ResultadoValidacaoCentrosCusto =
  | { ok: true; centros: readonly LinhaCentroCustoValidada[]; avisos: readonly ErroLinha[] }
  | { ok: false; erros: readonly ErroLinha[] };

const FORMATO_CLASSIFICACAO = /^\d+(\.\d+)*$/;
// O formato do reduzido só na aplicação, sem CHECK no banco: a numeração ainda pode mudar (GAP-CC-003).
const FORMATO_REDUZIDO = /^\d{2}\.\d{3}$/;
const LIMITE_DESCRICAO = 200;

const semAcento = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();

/** R17: o analítico com sufixo .0 no nível 3 ou .10 no nível 4 é o CC de gestão da unidade acima. */
export function ehDeGestao(classificacao: string, nivel: number, tipo: TipoCentroCusto): boolean {
  if (tipo !== 'ANALITICO') return false;
  return (nivel === 3 && classificacao.endsWith('.0')) || (nivel === 4 && classificacao.endsWith('.10'));
}

type Parcial = Omit<LinhaCentroCustoValidada, 'nivel' | 'tipo' | 'deGestao'> & { nivel: number | null; tipo: TipoCentroCusto | null };

/**
 * Regras da §6.1a e da R17: nível de 1 a 5 e igual aos segmentos; reduzido no formato 99.999,
 * obrigatório e único; tipo Sintético/Analítico, com "Aceita lançamento" coerente; analítico em
 * qualquer nível de 2 a 5; pai existente, sintético, do nível acima e prefixo; sintético com filho.
 * Avisa, sem bloquear, a diretoria (nível 2) e a gerência (nível 3) sintéticas sem exatamente um CC
 * de gestão (o nível 1 fica de fora, GAP-CC-005). As mensagens não repetem o conteúdo da célula.
 */
export function validarCentrosCusto(
  linhas: readonly LinhaLida[],
  sanear: (texto: string) => { texto: string; retirou: boolean },
): ResultadoValidacaoCentrosCusto {
  const erros: ErroLinha[] = [];
  const avisos: ErroLinha[] = [];
  const erro = (linha: number, coluna: string, mensagem: string) => erros.push({ linha, coluna, mensagem });
  if (linhas.length === 0) return { ok: false, erros: [{ linha: 0, mensagem: 'A planilha não tem centros de custo.' }] };

  const parciais: Parcial[] = [];
  for (const { numero, celulas } of linhas) {
    const nivelTexto = celulas['Nível'] ?? null;
    const nivel = nivelTexto !== null && /^[1-5]$/.test(nivelTexto) ? Number(nivelTexto) : null;
    if (nivel === null) erro(numero, 'Nível', 'O nível deve ser de 1 a 5.');

    const classificacao = celulas['Classificação'] ?? '';
    if (!FORMATO_CLASSIFICACAO.test(classificacao)) erro(numero, 'Classificação', 'A classificação deve ter só números separados por ponto.');
    else if (nivel !== null && classificacao.split('.').length !== nivel) {
      erro(numero, 'Classificação', 'A classificação deve ter tantos segmentos quanto o nível.');
    }

    const reduzido = celulas['Código reduzido'] ?? '';
    if (!FORMATO_REDUZIDO.test(reduzido)) erro(numero, 'Código reduzido', 'O código reduzido deve ter o formato 99.999 (como texto).');

    const tipoTexto = semAcento(celulas['Tipo'] ?? '');
    const tipo: TipoCentroCusto | null = tipoTexto === 'sintetico' ? 'SINTETICO' : tipoTexto === 'analitico' ? 'ANALITICO' : null;
    if (tipo === null) erro(numero, 'Tipo', 'O tipo deve ser Sintético ou Analítico.');
    if (tipo === 'ANALITICO' && nivel === 1) erro(numero, 'Tipo', 'O nível 1 não pode ser analítico.');

    const aceita = semAcento(celulas['Aceita lançamento'] ?? '');
    if (aceita !== 's' && aceita !== 'n') erro(numero, 'Aceita lançamento', 'Informe S ou N.');
    else if (tipo !== null && (aceita === 's') !== (tipo === 'ANALITICO')) {
      erro(numero, 'Aceita lançamento', 'Só o analítico aceita lançamento, e todo analítico aceita.');
    }

    const sugerida = sanear(celulas['Descrição sugerida'] ?? '');
    const original = celulas['Descrição (original)'] === null || celulas['Descrição (original)'] === undefined ? null : sanear(celulas['Descrição (original)']);
    const descricao = sugerida.texto.trim();
    if (descricao === '') erro(numero, 'Descrição sugerida', 'A descrição sugerida é obrigatória.');
    else if (descricao.length > LIMITE_DESCRICAO) erro(numero, 'Descrição sugerida', `A descrição deve ter até ${LIMITE_DESCRICAO} caracteres.`);
    if (sugerida.retirou || original?.retirou) avisos.push({ linha: numero, coluna: 'Descrição sugerida', mensagem: 'O nome da instituição foi retirado da descrição.' });

    parciais.push({
      linha: numero,
      classificacao,
      codigoReduzido: reduzido,
      descricao,
      descricaoOriginal: original === null || original.texto.trim() === '' ? null : original.texto.trim().slice(0, LIMITE_DESCRICAO),
      nivel,
      tipo,
      classificacaoPai: celulas['Classificação pai'] ?? null,
    });
  }

  const repetidas = (chave: (p: Parcial) => string | null, coluna: string, rotulo: string) => {
    const primeira = new Map<string, number>();
    for (const p of parciais) {
      const k = chave(p);
      if (k === null) continue;
      const antes = primeira.get(k);
      if (antes === undefined) primeira.set(k, p.linha);
      else {
        erro(antes, coluna, `${rotulo} repetido na linha ${p.linha}.`);
        erro(p.linha, coluna, `${rotulo} repetido na linha ${antes}.`);
      }
    }
  };
  repetidas((p) => (FORMATO_CLASSIFICACAO.test(p.classificacao) ? p.classificacao : null), 'Classificação', 'Classificação');
  repetidas((p) => (FORMATO_REDUZIDO.test(p.codigoReduzido) ? p.codigoReduzido : null), 'Código reduzido', 'Código reduzido');

  const porClassificacao = new Map(parciais.map((p) => [p.classificacao, p]));
  const filhos = new Map<string, Parcial[]>();
  for (const p of parciais) {
    if (p.nivel === null) continue;
    if (p.nivel === 1) {
      if (p.classificacaoPai !== null) erro(p.linha, 'Classificação pai', 'O nível 1 não tem classificação pai.');
      continue;
    }
    if (p.classificacaoPai === null) {
      erro(p.linha, 'Classificação pai', 'A classificação pai é obrigatória a partir do nível 2.');
      continue;
    }
    const pai = porClassificacao.get(p.classificacaoPai);
    if (!pai) {
      erro(p.linha, 'Classificação pai', 'A classificação pai não existe na planilha.');
      continue;
    }
    filhos.set(pai.classificacao, [...(filhos.get(pai.classificacao) ?? []), p]);
    if (pai.nivel !== null && pai.nivel !== p.nivel - 1) erro(p.linha, 'Classificação pai', 'O pai deve ter o nível imediatamente acima.');
    if (!p.classificacao.startsWith(`${pai.classificacao}.`)) erro(p.linha, 'Classificação pai', 'A classificação deve começar pela do pai.');
    if (pai.tipo === 'ANALITICO') erro(p.linha, 'Classificação pai', 'O pai não pode ser analítico.');
  }
  for (const p of parciais) {
    if (p.tipo === 'SINTETICO' && !filhos.has(p.classificacao)) erro(p.linha, 'Classificação', 'O centro de custo sintético precisa ter pelo menos um abaixo.');
  }
  if (erros.length > 0) return { ok: false, erros: erros.sort((a, b) => a.linha - b.linha) };

  const centros = parciais.map((p) => ({
    ...p,
    nivel: p.nivel as Nivel,
    tipo: p.tipo as TipoCentroCusto,
    classificacaoPai: p.nivel === 1 ? null : p.classificacaoPai,
    deGestao: ehDeGestao(p.classificacao, p.nivel as number, p.tipo as TipoCentroCusto),
  }));
  // R17 (regra R3 da minuta): diretoria e gerência sintéticas com exatamente um CC de gestão.
  for (const c of centros) {
    if (c.tipo !== 'SINTETICO' || (c.nivel !== 2 && c.nivel !== 3)) continue;
    const deGestao = (filhos.get(c.classificacao) ?? []).filter((f) => ehDeGestao(f.classificacao, f.nivel as number, f.tipo as TipoCentroCusto));
    if (deGestao.length !== 1) {
      avisos.push({
        linha: c.linha,
        coluna: 'Classificação',
        mensagem: `${c.nivel === 2 ? 'A diretoria' : 'A gerência'} ${c.classificacao} tem ${deGestao.length} centros de custo de gestão; o esperado é 1 (R3 da minuta).`,
      });
    }
  }
  return { ok: true, centros, avisos };
}
