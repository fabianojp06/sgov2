import type { Nivel, TipoConta } from './estrutura';

// Validação do plano de contas importado (US-043; spec §6.1; plano do P4, Task 4a). Pura: a
// leitura do .xlsx fica no ger (lerPlanilhaSegura) e o saneamento da marca é injetado.

/** Mesmo formato do LinhaPlanilha do ger (o domain/ não importa outro módulo). */
export type LinhaLida = { numero: number; celulas: Readonly<Record<string, string | null>> };
export type ErroLinha = { linha: number; coluna?: string; mensagem: string };

/** Layout da planilha oficial (aba "Plano de Contas", cabeçalho na linha 1). */
export const COLUNAS_PLANO_CONTAS = ['Nível', 'Classificação', 'Conta Superior', 'Descrição', 'Tipo', 'Conta Reduzida'] as const;

export type LinhaPlanoValidada = {
  linha: number;
  classificacao: string;
  codigoReduzido: string | null;
  descricao: string;
  nivel: Nivel;
  tipo: TipoConta;
  classificacaoPai: string | null;
};

export type ResultadoValidacaoPlano =
  | { ok: true; contas: readonly LinhaPlanoValidada[]; avisos: readonly ErroLinha[] }
  | { ok: false; erros: readonly ErroLinha[] };

const LIMITE_DESCRICAO = 200;
const FORMATO_CLASSIFICACAO = /^\d+(\.\d+)*$/;
const FORMATO_REDUZIDO = /^\d{1,10}$/;

type Parcial = Omit<LinhaPlanoValidada, 'nivel' | 'tipo'> & { nivel: number | null; tipo: TipoConta | null };

/**
 * Regras da §6.1: nível de 1 a 5; segmentos da classificação = nível; a conta superior existe,
 * tem nível − 1 e é prefixo da classificação; analítica ⇔ nível 5; reduzido obrigatório e único
 * nas analíticas (e ausente nas sintéticas); classificação única; sintética com pelo menos um
 * filho. Qualquer erro reprova o arquivo inteiro (Review Focus 3); as mensagens não repetem o
 * conteúdo da célula, só a posição.
 */
export function validarPlanoContas(
  linhas: readonly LinhaLida[],
  sanear: (texto: string) => { texto: string; retirou: boolean },
): ResultadoValidacaoPlano {
  const erros: ErroLinha[] = [];
  const avisos: ErroLinha[] = [];
  const erro = (linha: number, coluna: string | undefined, mensagem: string) => erros.push({ linha, ...(coluna ? { coluna } : {}), mensagem });

  if (linhas.length === 0) return { ok: false, erros: [{ linha: 0, mensagem: 'A planilha não tem contas.' }] };

  const parciais: Parcial[] = [];
  for (const { numero, celulas } of linhas) {
    const nivelTexto = celulas['Nível'] ?? null;
    const nivel = nivelTexto !== null && /^[1-5]$/.test(nivelTexto) ? Number(nivelTexto) : null;
    if (nivel === null) erro(numero, 'Nível', 'O nível deve ser de 1 a 5.');

    const classificacao = celulas['Classificação'] ?? '';
    if (!FORMATO_CLASSIFICACAO.test(classificacao)) {
      erro(numero, 'Classificação', 'A classificação deve ter só números separados por ponto.');
    } else if (nivel !== null && classificacao.split('.').length !== nivel) {
      erro(numero, 'Classificação', 'A classificação deve ter tantos segmentos quanto o nível.');
    }

    const tipoTexto = (celulas['Tipo'] ?? '').toUpperCase();
    const tipo: TipoConta | null = tipoTexto === 'S' ? 'SINTETICA' : tipoTexto === 'A' ? 'ANALITICA' : null;
    if (tipo === null) erro(numero, 'Tipo', 'O tipo deve ser S (sintética) ou A (analítica).');
    if (tipo !== null && nivel !== null && (tipo === 'ANALITICA') !== (nivel === 5)) {
      erro(numero, 'Tipo', 'Só as contas de nível 5 são analíticas, e todas elas são.');
    }

    const reduzido = celulas['Conta Reduzida'] ?? null;
    if (tipo === 'ANALITICA' && reduzido === null) erro(numero, 'Conta Reduzida', 'A conta analítica precisa da conta reduzida.');
    if (tipo === 'SINTETICA' && reduzido !== null) erro(numero, 'Conta Reduzida', 'A conta sintética não tem conta reduzida.');
    if (reduzido !== null && !FORMATO_REDUZIDO.test(reduzido)) erro(numero, 'Conta Reduzida', 'A conta reduzida deve ter só números.');

    const bruta = celulas['Descrição'] ?? '';
    const saneada = sanear(bruta);
    const descricao = saneada.texto.trim();
    if (descricao === '') erro(numero, 'Descrição', 'A descrição é obrigatória.');
    else if (descricao.length > LIMITE_DESCRICAO) erro(numero, 'Descrição', `A descrição deve ter até ${LIMITE_DESCRICAO} caracteres.`);
    if (saneada.retirou) avisos.push({ linha: numero, coluna: 'Descrição', mensagem: 'O nome da instituição foi retirado da descrição.' });

    parciais.push({
      linha: numero,
      classificacao,
      codigoReduzido: reduzido,
      descricao,
      nivel,
      tipo,
      classificacaoPai: celulas['Conta Superior'] ?? null,
    });
  }

  // Repetições: as duas linhas são citadas.
  const repetidas = <K>(chave: (p: Parcial) => K | null, coluna: string, mensagem: (outra: number) => string) => {
    const primeira = new Map<K, number>();
    for (const p of parciais) {
      const k = chave(p);
      if (k === null) continue;
      const antes = primeira.get(k);
      if (antes === undefined) primeira.set(k, p.linha);
      else {
        erro(antes, coluna, mensagem(p.linha));
        erro(p.linha, coluna, mensagem(antes));
      }
    }
  };
  repetidas((p) => (FORMATO_CLASSIFICACAO.test(p.classificacao) ? p.classificacao : null), 'Classificação', (o) => `Classificação repetida na linha ${o}.`);
  repetidas((p) => p.codigoReduzido, 'Conta Reduzida', (o) => `Conta reduzida repetida na linha ${o}.`);

  const porClassificacao = new Map(parciais.map((p) => [p.classificacao, p]));
  const comFilhos = new Set<string>();
  for (const p of parciais) {
    if (p.nivel === null) continue;
    if (p.nivel === 1) {
      if (p.classificacaoPai !== null) erro(p.linha, 'Conta Superior', 'A conta de nível 1 não tem conta superior.');
      continue;
    }
    if (p.classificacaoPai === null) {
      erro(p.linha, 'Conta Superior', 'A conta superior é obrigatória a partir do nível 2.');
      continue;
    }
    const pai = porClassificacao.get(p.classificacaoPai);
    if (!pai) {
      erro(p.linha, 'Conta Superior', 'A conta superior não existe na planilha.');
      continue;
    }
    comFilhos.add(pai.classificacao);
    if (pai.nivel !== null && pai.nivel !== p.nivel - 1) erro(p.linha, 'Conta Superior', 'A conta superior deve ter o nível imediatamente acima.');
    if (!p.classificacao.startsWith(`${pai.classificacao}.`)) erro(p.linha, 'Conta Superior', 'A classificação deve começar pela da conta superior.');
    if (pai.tipo === 'ANALITICA') erro(p.linha, 'Conta Superior', 'A conta superior não pode ser analítica.');
  }
  for (const p of parciais) {
    if (p.tipo === 'SINTETICA' && !comFilhos.has(p.classificacao)) erro(p.linha, 'Classificação', 'A conta sintética precisa ter pelo menos uma conta abaixo.');
  }

  if (erros.length > 0) return { ok: false, erros: erros.sort((a, b) => a.linha - b.linha) };
  return {
    ok: true,
    contas: parciais.map((p) => ({ ...p, nivel: p.nivel as Nivel, tipo: p.tipo as TipoConta, classificacaoPai: p.nivel === 1 ? null : p.classificacaoPai })),
    avisos,
  };
}
