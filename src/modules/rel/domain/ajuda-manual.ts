import { listarAcoes, type ModuloManual } from './manual';

// Ajuda "como faço..." com base no manual (US-108, IA-18). A IA responde só com o manual de quem
// pergunta (o do perfil, US-118) e cita os trechos pelo identificador; a tela mostra o texto do
// manual como está no catálogo, nunca um trecho escrito pela IA. Puro: a chamada fica em application/.
//
// GAP-IA-002 (provedor de embeddings): o manual de um perfil cabe inteiro na mensagem, então a ajuda
// não precisa de busca semântica por enquanto. Ela entra quando o manual crescer além disso.

export const MINIMO_PERGUNTA = 5;
export const MAXIMO_PERGUNTA = 500;
export const MAXIMO_RESPOSTA = 2000;
export const MAXIMO_CITACOES = 5;

/** Um trecho citável: uma funcionalidade do manual, com o texto de ajuda e as ações do perfil. */
export type TrechoManual = Readonly<{ id: string; local: string; nome: string; rota: string; texto: string }>;

/** A resposta já conferida, para a tela. Sem trecho válido, não há resposta. */
export type AjudaManual = Readonly<{ encontrou: true; resposta: string; trechos: readonly TrechoManual[] }> | Readonly<{ encontrou: false }>;

/** A saída da IA, já validada pelo schema (application/). */
export type SaidaAjuda = Readonly<{ encontrou: boolean; resposta: string; trechos: readonly string[] }>;

// Caracteres como o char_length do PostgreSQL conta (pontos de código), como no orc.
export const contarCaracteres = (texto: string): number => [...texto].length;

// As marcas que cercam a pergunta na mensagem não podem aparecer dentro dela. Repete até não mudar:
// tirar uma marca pode juntar os pedaços de outra ('<<>>><' → '<<<').
export function semMarcas(t: string): string {
  let atual = t;
  for (;;) {
    const limpo = atual.replaceAll('<<<', '').replaceAll('>>>', '');
    if (limpo === atual) return limpo;
    atual = limpo;
  }
}

/** Os trechos do manual, na ordem do menu, numerados T1, T2... */
export function trechosDoManual(manual: readonly ModuloManual[]): readonly TrechoManual[] {
  const trechos: TrechoManual[] = [];
  for (const m of manual)
    for (const g of m.grupos)
      for (const f of g.funcionalidades) {
        const ajuda = f.ajuda ?? 'Sem texto de ajuda.';
        trechos.push({ id: `T${trechos.length + 1}`, local: `${m.nome} › ${g.nome}`, nome: f.nome, rota: f.rota, texto: `${ajuda} Você pode: ${listarAcoes(f.acoes)}.` });
      }
  return trechos;
}

/** A mensagem à IA: o manual do perfil e a pergunta entre as marcas. Nada de quem pergunta (nome, login). */
export function mensagemAjuda(trechos: readonly TrechoManual[], pergunta: string): string {
  return [
    'Manual do perfil de quem pergunta:',
    ...trechos.map((t) => `[${t.id}] ${t.local} › ${t.nome} (tela ${t.rota}): ${semMarcas(t.texto)}`),
    '',
    `Pergunta: <<<${semMarcas(pergunta)}>>>`,
  ].join('\n');
}

/**
 * Confere a saída da IA contra o manual: só ficam os trechos que existem, sem repetição, na ordem da
 * IA. Sem nenhum trecho válido, ou quando a IA diz que não encontrou, a ajuda não responde (a IA não
 * pode responder sem citar o manual).
 */
export function conferirAjuda(saida: SaidaAjuda, trechos: readonly TrechoManual[]): AjudaManual {
  const porId = new Map(trechos.map((t) => [t.id, t]));
  const citados: TrechoManual[] = [];
  for (const id of saida.trechos) {
    const t = porId.get(id.trim().toUpperCase());
    if (t && !citados.includes(t)) citados.push(t);
  }
  const resposta = saida.resposta.trim();
  if (!saida.encontrou || citados.length === 0 || resposta === '') return { encontrou: false };
  return { encontrou: true, resposta, trechos: citados.slice(0, MAXIMO_CITACOES) };
}
