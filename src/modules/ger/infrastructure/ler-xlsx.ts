import { Readable } from 'node:stream';
import { falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { empacotarSemCompressao, lerZipSeguro, ZipInvalido } from './zip-seguro';

// Leitura segura de .xlsx (plano do P4, R4; acréscimo ao C3 em @/modules/ger/servidor).
// Ordem: limites do zip e do XML ANTES do ExcelJS; o ExcelJS só lê um zip montado por nós (sem
// compressão, só a aba escolhida e as strings, entregue em fatias); depois, limites de linhas,
// colunas e caracteres. As mensagens de erro nunca citam o conteúdo da célula (pode ser salário).
// Texto de célula que começa com = + - @ volta como veio: quem exportar para CSV neutraliza.

export type LimitesPlanilha = {
  bytes: number;
  entradas: number;
  descompactado: number;
  razao: number;
  linhas: number;
  colunas: number;
  caracteresCelula: number;
};

export const LIMITES_PADRAO: LimitesPlanilha = Object.freeze({
  bytes: 1024 * 1024,
  entradas: 50,
  descompactado: 20 * 1024 * 1024,
  razao: 100,
  linhas: 20_000,
  colunas: 30,
  caracteresCelula: 1_000,
});

/** Chave = nome da coluna como pedido em `opcoes.colunas`. */
export type LinhaPlanilha = { numero: number; celulas: Readonly<Record<string, string | null>> };
export type ErroLinha = { linha: number; coluna?: string; mensagem: string };

export type OpcoesLeitura = {
  /** Sem aba, lê a primeira na ordem do workbook. */
  aba?: string;
  /** Colunas obrigatórias, achadas pelo nome sem diferenciar maiúsculas, acentos e espaços. */
  colunas: readonly string[];
  /** O cabeçalho é a primeira linha, até esta, que tem todas as colunas. */
  linhaCabecalhoMax: number;
  /** Prazo da leitura pelo ExcelJS, para testes: no máximo (e por padrão) 30 s. */
  prazoMs?: number;
  /** Colunas que não aceitam célula numérica ("14.180" viraria 14,18; GAP-CC-003). */
  colunasTexto?: readonly string[];
  limites?: Partial<LimitesPlanilha>;
};

export type PlanilhaLida = { nomeArquivo: string; linhas: readonly LinhaPlanilha[]; errosCelula: readonly ErroLinha[] };

const MSG_INVALIDA = 'Planilha inválida ou grande demais.';
/** Texto exato da recusa pelo semáforo (uma leitura por processo), parte do contrato (#231). */
export const MSG_LEITOR_OCUPADO = 'Outra planilha está sendo lida. Tente de novo em instantes.';
const erroArquivo = (mensagem: string) => falha([{ campo: 'arquivo', mensagem }]);

/** Nome sem caminho nem caractere de controle, com até 120 caracteres. */
export function sanearNomeArquivo(nome: string): string {
  const base = nome.split(/[\\/]/).pop() ?? '';
  const limpo = base.replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
  return (limpo === '' || limpo === '.' || limpo === '..' ? 'planilha.xlsx' : limpo).slice(0, 120);
}

export function normalizarNomeColuna(nome: string): string {
  return nome.normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Um processo lê no máximo uma planilha por vez (R4): a segunda chamada é recusada na hora.
let ocupado = false;
const PRAZO_LEITURA_MS = 30_000;
const FATIA = 64 * 1024;

const DTD = /<!(DOCTYPE|ENTITY)/i;
const SST_VAZIO = '<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="0" uniqueCount="0"/>';
const decodificador = new TextDecoder('utf-8', { fatal: false });

// Código fora do Unicode ou de surrogate vira U+FFFD (String.fromCodePoint lançaria).
function caractere(codigo: number): string {
  return codigo > 0x10ffff || (codigo >= 0xd800 && codigo <= 0xdfff) ? '\uFFFD' : String.fromCodePoint(codigo);
}

function desfazerEntidades(v: string): string {
  return v
    .replace(/&#x([0-9a-f]{1,8});/gi, (_, h: string) => caractere(Number.parseInt(h, 16)))
    .replace(/&#(\d{1,10});/g, (_, d: string) => caractere(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function atributos(tag: string): Map<string, string> {
  const m = new Map<string, string>();
  // O espaço antes do nome ancora cada tentativa: sem ele, uma sequência longa sem "=" volta
  // atrás a cada posição (tempo quadrático com o event loop parado).
  for (const [, nome, v1, v2] of tag.matchAll(/\s([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) m.set(nome!, desfazerEntidades(v1 ?? v2 ?? ''));
  return m;
}

// Caminho do alvo de um relacionamento do workbook: absoluto ("/xl/worksheets/sheet1.xml") ou
// relativo a xl/ ("worksheets/sheet1.xml"). Devolve o nome da entrada no zip.
function alvoNoZip(target: string): string {
  const t = target.replace(/\\/g, '/');
  return t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`;
}

/** Abas na ordem do workbook, com o arquivo de cada uma. O ExcelJS não entende alvo absoluto. */
// workbook.xml e .rels reais têm poucos KB; o teto limita o custo das regexes.
const LIMITE_XML_WORKBOOK = 256 * 1024;

function abasDoWorkbook(entradas: ReadonlyMap<string, Uint8Array>): { nome: string; arquivo: string }[] | null {
  const workbook = entradas.get('xl/workbook.xml');
  const rels = entradas.get('xl/_rels/workbook.xml.rels');
  if (!workbook || !rels || workbook.length > LIMITE_XML_WORKBOOK || rels.length > LIMITE_XML_WORKBOOK) return null;
  const alvos = new Map<string, string>();
  for (const [tag] of decodificador.decode(rels).matchAll(/<Relationship\b[^>]*>/g)) {
    const a = atributos(tag);
    const id = a.get('Id');
    const target = a.get('Target');
    if (id && target) alvos.set(id, alvoNoZip(target));
  }
  const abas: { nome: string; arquivo: string }[] = [];
  for (const [tag] of decodificador.decode(workbook).matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)) {
    const a = atributos(tag);
    const id = [...a].find(([k]) => /(^|:)id$/.test(k) && k !== 'sheetId')?.[1];
    const arquivo = id === undefined ? undefined : alvos.get(id);
    const nome = a.get('name');
    if (nome !== undefined && arquivo !== undefined && /^xl\/worksheets\/[^/]+\.xml$/.test(arquivo) && entradas.has(arquivo)) {
      abas.push({ nome, arquivo });
    }
  }
  return abas;
}

// O zip que o ExcelJS lê: só o necessário, com a aba escolhida como sheet1 e o workbook mínimo
// apontando para ela. Nenhuma outra entrada do arquivo do usuário chega ao ExcelJS (sem isca de
// nome parecido, sem DTD escondido) e as strings vêm antes da planilha (sem arquivo temporário).
function zipParaExcelJS(entradas: ReadonlyMap<string, Uint8Array>, arquivoAba: string): Uint8Array {
  const texto = (s: string) => new TextEncoder().encode(s);
  const workbook = texto(
    '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Aba" sheetId="1" r:id="rId1"/></sheets></workbook>',
  );
  const rels = texto(
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '</Relationships>',
  );
  return empacotarSemCompressao([
    ['xl/_rels/workbook.xml.rels', rels],
    ['xl/workbook.xml', workbook],
    ['xl/sharedStrings.xml', entradas.get('xl/sharedStrings.xml') ?? texto(SST_VAZIO)],
    ['xl/worksheets/sheet1.xml', entradas.get(arquivoAba)!],
  ]);
}

function* emFatias(b: Uint8Array): Generator<Buffer> {
  for (let i = 0; i < b.length; i += FATIA) yield Buffer.from(b.buffer, b.byteOffset + i, Math.min(FATIA, b.length - i));
}

function recusar(motivo: string) {
  // Só o motivo técnico vai para o log, nunca o conteúdo do arquivo.
  console.warn('[PLANILHA_RECUSADA]', { motivo });
  return erroArquivo(MSG_INVALIDA);
}

// Valor de célula do ExcelJS → texto. Número: no máximo 2 casas e menos de 15 dígitos
// significativos, para nunca virar dinheiro errado (Review Focus 1).
type Convertido = { valor: string | null } | { erro: string };
function converter(v: unknown): Convertido {
  if (v === null || v === undefined) return { valor: null };
  if (typeof v === 'string') {
    // Sem caracteres de formatação invisíveis (bidi, largura zero), que esconderiam texto.
    const t = v.replace(/\p{Cf}/gu, '').trim();
    return { valor: t === '' ? null : t };
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { erro: 'Número inválido.' };
    const s = String(v);
    if (/e/i.test(s)) return { erro: 'Número fora do formato aceito.' };
    const [inteira = '', decimal = ''] = s.replace('-', '').split('.');
    if (decimal.length > 2) return { erro: 'Número com mais de 2 casas decimais.' };
    if ((inteira.replace(/^0+/, '') + decimal).length >= 15) return { erro: 'Número com dígitos demais.' };
    return { valor: s };
  }
  if (typeof v === 'boolean') return { valor: v ? 'VERDADEIRO' : 'FALSO' };
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? { erro: 'Data inválida.' } : { valor: v.toISOString().slice(0, 10) };
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('formula' in o || 'sharedFormula' in o) {
      if (o.result === undefined || o.result === null) return { erro: 'Fórmula sem resultado calculado. Salve a planilha no Excel e envie de novo.' };
      return converter(o.result);
    }
    if ('error' in o) return { erro: 'Célula com erro do Excel.' };
    if (Array.isArray(o.richText)) {
      return converter((o.richText as { text?: unknown }[]).map((p) => (typeof p.text === 'string' ? p.text : '')).join(''));
    }
    if (typeof o.text === 'string') return converter(o.text);
  }
  return { erro: 'Conteúdo de célula não suportado.' };
}

/**
 * Lê uma aba de .xlsx com os limites da R4. Erro de arquivo (zip, XML, limites, cabeçalho)
 * reprova tudo; erro de célula vai para `errosCelula`, com a célula como null.
 */
export async function lerPlanilhaSegura(
  arquivo: { nome: string; conteudo: Uint8Array },
  opcoes: OpcoesLeitura,
): Promise<Resultado<PlanilhaLida>> {
  if (ocupado) return erroArquivo(MSG_LEITOR_OCUPADO);
  ocupado = true;
  try {
    const limites = { ...LIMITES_PADRAO, ...opcoes.limites };
    const aberto = abrir(arquivo, limites);
    return 'erro' in aberto ? aberto.erro : await ler(aberto, opcoes, limites);
  } finally {
    ocupado = false;
  }
}

/** Pedido de uma aba em `lerPlanilhasSegura`: os limites do zip são da chamada, não da aba. */
export type PedidoAba = Omit<OpcoesLeitura, 'limites'> & { limites?: Partial<Pick<LimitesPlanilha, 'linhas' | 'colunas' | 'caracteresCelula'>> };

/** Erro de `lerPlanilhasSegura`: `indiceAba` diz qual pedido falhou (null: o arquivo ou o semáforo). */
export type ResultadoAbas = { ok: true; valor: readonly PlanilhaLida[] } | { ok: false; erros: readonly ErroCampo[]; indiceAba: number | null };

export const MAXIMO_ABAS = 10;
const falhaAba = (r: Resultado<unknown>, indiceAba: number | null): ResultadoAbas => ({ ok: false, erros: r.ok ? [] : r.erros, indiceAba });

/**
 * Lê várias abas do mesmo .xlsx numa chamada (#231): o semáforo fica preso do começo ao fim (uma
 * leitura concorrente não entra entre uma aba e outra) e o zip é aberto uma vez só. Cada aba tem
 * as próprias colunas e limites de linhas, colunas e caracteres; os limites do zip vêm de `limites`.
 * O prazo é um só para a chamada inteira (30 s), dividido na ordem das abas. De 1 a 10 abas, sem
 * repetir. Erro em qualquer aba reprova tudo, com o índice do pedido; o resultado vem na ordem pedida.
 */
export async function lerPlanilhasSegura(
  arquivo: { nome: string; conteudo: Uint8Array },
  pedidos: readonly PedidoAba[],
  limites?: Partial<LimitesPlanilha> & { prazoMs?: number },
): Promise<ResultadoAbas> {
  const nomes = pedidos.map((p) => (p.aba === undefined ? '' : normalizarNomeColuna(p.aba)));
  if (pedidos.length === 0 || pedidos.length > MAXIMO_ABAS || new Set(nomes).size !== nomes.length) {
    // Erro do chamador, não do arquivo: o texto fica no contrato.
    throw new Error(`lerPlanilhasSegura: de 1 a ${MAXIMO_ABAS} abas, sem repetir`);
  }
  if (ocupado) return falhaAba(erroArquivo(MSG_LEITOR_OCUPADO), null);
  ocupado = true;
  try {
    const { prazoMs, ...doZipPedido } = limites ?? {};
    const doZip = { ...LIMITES_PADRAO, ...doZipPedido };
    const aberto = abrir(arquivo, doZip);
    if ('erro' in aberto) return falhaAba(aberto.erro, null);
    const fim = Date.now() + Math.min(prazoMs ?? PRAZO_LEITURA_MS, PRAZO_LEITURA_MS);
    const lidas: PlanilhaLida[] = [];
    for (const [i, pedido] of pedidos.entries()) {
      const restante = fim - Date.now();
      if (restante <= 0) return falhaAba(recusar('prazo de leitura'), i);
      const r = await ler(aberto, { ...pedido, prazoMs: Math.min(pedido.prazoMs ?? restante, restante) }, { ...doZip, ...pedido.limites });
      if (!r.ok) return falhaAba(r, i);
      lidas.push(r.valor);
    }
    return { ok: true, valor: lidas };
  } finally {
    ocupado = false;
  }
}

type Aberto = { nomeArquivo: string; entradas: ReadonlyMap<string, Uint8Array>; abas: readonly { nome: string; arquivo: string }[] };

// Zip e workbook, conferidos uma vez por arquivo.
function abrir(arquivo: { nome: string; conteudo: Uint8Array }, limites: LimitesPlanilha): Aberto | { erro: Resultado<never> } {
  const nomeArquivo = sanearNomeArquivo(arquivo.nome);
  let entradas: Map<string, Uint8Array>;
  try {
    entradas = lerZipSeguro(arquivo.conteudo, limites);
  } catch (e) {
    if (e instanceof ZipInvalido) return { erro: recusar(e.motivo) };
    throw e;
  }
  const abas = abasDoWorkbook(entradas);
  if (abas === null || abas.length === 0) return { erro: recusar('sem workbook ou sem abas') };
  return { nomeArquivo, entradas, abas };
}

async function ler({ nomeArquivo, entradas, abas }: Aberto, opcoes: OpcoesLeitura, limites: LimitesPlanilha): Promise<Resultado<PlanilhaLida>> {
  const abaPedida = opcoes.aba === undefined ? undefined : normalizarNomeColuna(opcoes.aba);
  const aba = abaPedida === undefined ? abas[0] : abas.find((a) => normalizarNomeColuna(a.nome) === abaPedida);
  if (!aba) return erroArquivo(`A aba "${opcoes.aba}" não foi encontrada.`);
  // DTD em qualquer XML que o ExcelJS vai ler (e UTF-16, que o teste em latin1 não enxergaria).
  for (const nome of ['xl/sharedStrings.xml', aba.arquivo]) {
    const dados = entradas.get(nome);
    if (!dados) continue;
    if ((dados[0] === 0xfe && dados[1] === 0xff) || (dados[0] === 0xff && dados[1] === 0xfe) || dados.includes(0)) {
      return recusar('xml fora de UTF-8');
    }
    if (DTD.test(new TextDecoder('latin1').decode(dados))) return recusar('xml com DTD');
  }

  const zip = zipParaExcelJS(entradas, aba.arquivo);
  const { default: ExcelJS } = await import('exceljs');
  // Em fatias: uma entrada sem compressão de 20 MB num chunk só faz o parser juntar todos os
  // eventos de uma vez (estouro de memória com um arquivo pequeno).
  const fonte = Readable.from(emFatias(zip));
  const leitor = new ExcelJS.stream.xlsx.WorkbookReader(fonte, {
    worksheets: 'emit',
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'ignore',
    entries: 'ignore',
  });

  const exigidas = opcoes.colunas.map((c) => ({ nome: c, chave: normalizarNomeColuna(c) }));
  let falhaArquivo: string | null = null;
  const linhas: LinhaPlanilha[] = [];
  const errosCelula: ErroLinha[] = [];
  const somenteTexto = new Set(opcoes.colunasTexto ?? []);

  async function consumir(): Promise<void> {
    for await (const planilha of leitor) {
      let indices: Map<string, number> | null = null;
      let lidas = 0;
      for await (const linha of planilha) {
        // Depois de uma falha, o resto só é consumido (o stream não pode parar no meio).
        if (falhaArquivo !== null) continue;
        const valores = linha.values as unknown[];
        // O limite conta as linhas de dados; as de antes do cabeçalho já têm o teto linhaCabecalhoMax.
        if (indices !== null) lidas++;
        if (lidas > limites.linhas) {
          falhaArquivo = `A planilha passa de ${limites.linhas} linhas.`;
          continue;
        }
        if (valores.length - 1 > limites.colunas) {
          falhaArquivo = `A planilha passa de ${limites.colunas} colunas.`;
          continue;
        }
        if (indices === null) {
          if (linha.number > opcoes.linhaCabecalhoMax) {
            falhaArquivo = `Cabeçalho não encontrado nas ${opcoes.linhaCabecalhoMax} primeiras linhas.`;
            continue;
          }
          const porNome = new Map<string, number>();
          valores.forEach((v, i) => {
            if (typeof v === 'string' && !porNome.has(normalizarNomeColuna(v))) porNome.set(normalizarNomeColuna(v), i);
          });
          if (exigidas.every((c) => porNome.has(c.chave))) {
            indices = new Map(exigidas.map((c) => [c.nome, porNome.get(c.chave)!]));
          }
          continue;
        }
        const celulas: Record<string, string | null> = {};
        let vazia = true;
        for (const [nome, i] of indices) {
          const bruto = valores[i];
          const c: Convertido =
            somenteTexto.has(nome) && typeof bruto === 'number'
              ? { erro: 'Esta coluna deve ser texto: formate a célula como texto no Excel (um número perde os zeros).' }
              : converter(bruto);
          if ('erro' in c) {
            errosCelula.push({ linha: linha.number, coluna: nome, mensagem: c.erro });
            celulas[nome] = null;
            vazia = false;
          } else if (c.valor !== null && c.valor.length > limites.caracteresCelula) {
            errosCelula.push({ linha: linha.number, coluna: nome, mensagem: `Célula com mais de ${limites.caracteresCelula} caracteres.` });
            celulas[nome] = null;
            vazia = false;
          } else {
            celulas[nome] = c.valor;
            if (c.valor !== null) vazia = false;
          }
        }
        if (!vazia) linhas.push({ numero: linha.number, celulas: Object.freeze(celulas) });
      }
      if (falhaArquivo === null && indices === null) {
        falhaArquivo = `Cabeçalho não encontrado. Colunas esperadas: ${exigidas.map((c) => c.nome).join(', ')}.`;
      }
    }
  }

  // Prazo pela promessa, não pelo stream: destruir a fonte não encerra o parser do ExcelJS (e um
  // 'error' sem ouvinte derrubaria o processo). Depois do prazo, a leitura é recusada e o
  // semáforo, liberado; o que sobrar do parser termina sozinho, sem ninguém esperando. Nesse
  // instante, o limite de uma leitura por processo deixa de ser estrito (o parser parado não custa).
  fonte.on('error', () => undefined);
  const consumo = consumir();
  consumo.catch(() => undefined);
  let temporizador: NodeJS.Timeout | undefined;
  const estouro = new Promise<'prazo'>((resolver) => {
    temporizador = setTimeout(() => resolver('prazo'), Math.min(opcoes.prazoMs ?? PRAZO_LEITURA_MS, PRAZO_LEITURA_MS));
  });
  try {
    if ((await Promise.race([consumo.then(() => 'lida' as const), estouro])) === 'prazo') {
      fonte.destroy();
      return recusar('prazo de leitura');
    }
  } catch (e) {
    // Só a classe do erro: a mensagem do parser pode trazer nomes escolhidos pelo arquivo.
    return recusar(`leitura da planilha: ${e instanceof Error ? e.name : 'desconhecido'}`);
  } finally {
    clearTimeout(temporizador);
  }
  if (falhaArquivo !== null) return erroArquivo(falhaArquivo);
  return ok({ nomeArquivo, linhas, errosCelula });
}
