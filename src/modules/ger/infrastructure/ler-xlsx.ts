import { Readable } from 'node:stream';
import { falha, ok, type Resultado } from '@/shared/kernel';
import { empacotarSemCompressao, lerZipSeguro, ZipInvalido } from './zip-seguro';

// Leitura segura de .xlsx (plano do P4, R4; acréscimo ao C3 em @/modules/ger/servidor).
// Ordem: limites do zip e do XML ANTES do ExcelJS; o ExcelJS só lê um zip reempacotado por nós
// (sem compressão, com as entradas já validadas) e em stream; depois, limites de linhas, colunas
// e caracteres. As mensagens de erro nunca citam o conteúdo da célula (pode ser salário).

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
  /** Sem aba, lê a primeira. */
  aba?: string;
  /** Colunas obrigatórias, achadas pelo nome sem diferenciar maiúsculas, acentos e espaços. */
  colunas: readonly string[];
  /** O cabeçalho é a primeira linha, até esta, que tem todas as colunas. */
  linhaCabecalhoMax: number;
  limites?: Partial<LimitesPlanilha>;
};

export type PlanilhaLida = { nomeArquivo: string; linhas: readonly LinhaPlanilha[]; errosCelula: readonly ErroLinha[] };

const MSG_INVALIDA = 'Planilha inválida ou grande demais.';
const MSG_OCUPADO = 'Outra planilha está sendo lida. Tente de novo em instantes.';
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

const ehXml = (nome: string) => /\.(xml|rels|vml)$/i.test(nome);
const DTD = /<!(DOCTYPE|ENTITY)/i;
const ehPlanilha = (nome: string) => /^xl\/worksheets\/sheet\d+\.xml$/.test(nome);

// Valor de célula do ExcelJS → texto. Número: no máximo 2 casas e menos de 15 dígitos
// significativos, para nunca virar dinheiro errado (Review Focus 1).
type Convertido = { valor: string | null } | { erro: string };
function converter(v: unknown): Convertido {
  if (v === null || v === undefined) return { valor: null };
  if (typeof v === 'string') {
    const t = v.trim();
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
  if (ocupado) return erroArquivo(MSG_OCUPADO);
  ocupado = true;
  try {
    return await ler(arquivo, opcoes, { ...LIMITES_PADRAO, ...opcoes.limites });
  } finally {
    ocupado = false;
  }
}

async function ler(arquivo: { nome: string; conteudo: Uint8Array }, opcoes: OpcoesLeitura, limites: LimitesPlanilha) {
  const nomeArquivo = sanearNomeArquivo(arquivo.nome);
  let entradas: Map<string, Uint8Array>;
  try {
    entradas = lerZipSeguro(arquivo.conteudo, limites);
  } catch (e) {
    if (e instanceof ZipInvalido) return erroArquivo(MSG_INVALIDA);
    throw e;
  }
  const latin1 = new TextDecoder('latin1');
  for (const [nome, dados] of entradas) {
    if (ehXml(nome) && DTD.test(latin1.decode(dados))) return erroArquivo(MSG_INVALIDA);
  }

  // As planilhas por último: o leitor em stream precisa do workbook e das strings antes delas
  // (sem isso, o ExcelJS grava cada planilha em arquivo temporário).
  const ordem = [...entradas].sort(([a], [b]) => Number(ehPlanilha(a)) - Number(ehPlanilha(b)));
  const zip = empacotarSemCompressao(ordem);

  const { default: ExcelJS } = await import('exceljs');
  const leitor = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from([Buffer.from(zip)]), {
    worksheets: 'emit',
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'ignore',
    entries: 'ignore',
  });

  const exigidas = opcoes.colunas.map((c) => ({ nome: c, chave: normalizarNomeColuna(c) }));
  const abaPedida = opcoes.aba === undefined ? undefined : normalizarNomeColuna(opcoes.aba);
  let achouAba = false;
  let falhaArquivo: string | null = null;
  const linhas: LinhaPlanilha[] = [];
  const errosCelula: ErroLinha[] = [];

  try {
    for await (const planilha of leitor) {
      const nomeAba = (planilha as unknown as { name?: string }).name ?? '';
      const escolhida = !achouAba && (abaPedida === undefined || normalizarNomeColuna(nomeAba) === abaPedida);
      let indices: Map<string, number> | null = null;
      let lidas = 0;
      for await (const linha of planilha) {
        // As outras abas são só consumidas (o stream não pode parar no meio).
        if (!escolhida || falhaArquivo !== null) continue;
        lidas++;
        const valores = linha.values as unknown[];
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
          const c = converter(valores[i]);
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
      if (escolhida) {
        achouAba = true;
        if (falhaArquivo === null && indices === null) {
          const faltam = exigidas.map((c) => c.nome).join(', ');
          falhaArquivo = `Cabeçalho não encontrado. Colunas esperadas: ${faltam}.`;
        }
      }
    }
  } catch {
    return erroArquivo(MSG_INVALIDA);
  }
  if (!achouAba) return erroArquivo(opcoes.aba === undefined ? MSG_INVALIDA : `A aba "${opcoes.aba}" não foi encontrada.`);
  if (falhaArquivo !== null) return erroArquivo(falhaArquivo);
  return ok({ nomeArquivo, linhas, errosCelula });
}
