import { crc32, inflateRawSync } from 'node:zlib';

// Leitura defensiva de um .zip (plano do P4, R4): o .xlsx de um usuário é tratado como hostil.
// O diretório central é lido à mão, com limites ANTES de descompactar, e cada entrada é inflada
// com teto de saída igual ao tamanho declarado. Nada aqui confia no que o arquivo diz de si sem
// conferir: tamanho real = declarado, CRC confere, entradas não se sobrepõem, nome não se repete.
// O resultado é reempacotado por `empacotarSemCompressao`, para que o leitor de planilha só veja
// bytes que este módulo validou (sem diferença de interpretação entre dois leitores de zip).

export type LimitesZip = {
  /** Tamanho máximo do arquivo compactado. */
  bytes: number;
  entradas: number;
  /** Soma máxima dos tamanhos descompactados. */
  descompactado: number;
  /** Razão máxima descompactado ÷ compactado, por entrada. */
  razao: number;
};

export class ZipInvalido extends Error {
  constructor(readonly motivo: string) {
    super('Planilha inválida ou grande demais.');
    this.name = 'ZipInvalido';
  }
}

const ASSINATURA_LOCAL = 0x04034b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const ASSINATURA_FIM = 0x06054b50;
const TAMANHO_FIM = 22;
const MAX_COMENTARIO = 0xffff;

type EntradaCentral = {
  nome: string;
  metodo: number;
  crc: number;
  compactado: number;
  descompactado: number;
  deslocamento: number;
};

function lerU16(b: Uint8Array, i: number): number {
  return b[i]! | (b[i + 1]! << 8);
}
function lerU32(b: Uint8Array, i: number): number {
  return (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;
}

function acharFim(b: Uint8Array): number {
  const inicio = Math.max(0, b.length - TAMANHO_FIM - MAX_COMENTARIO);
  for (let i = b.length - TAMANHO_FIM; i >= inicio; i--) {
    if (lerU32(b, i) === ASSINATURA_FIM && i + TAMANHO_FIM + lerU16(b, i + 20) === b.length) return i;
  }
  throw new ZipInvalido('sem fim do diretório central');
}

function lerDiretorio(b: Uint8Array, limites: LimitesZip): EntradaCentral[] {
  const fim = acharFim(b);
  if (lerU16(b, fim + 4) !== 0 || lerU16(b, fim + 6) !== 0) throw new ZipInvalido('zip em vários volumes');
  const total = lerU16(b, fim + 10);
  if (total !== lerU16(b, fim + 8)) throw new ZipInvalido('contagem de entradas inconsistente');
  // 0xFFFF / 0xFFFFFFFF indicam ZIP64, que um .xlsx deste tamanho nunca precisa.
  if (total === 0xffff) throw new ZipInvalido('zip64');
  if (total === 0) throw new ZipInvalido('zip vazio');
  if (total > limites.entradas) throw new ZipInvalido('entradas demais');
  const tamanhoDiretorio = lerU32(b, fim + 12);
  const inicioDiretorio = lerU32(b, fim + 16);
  if (inicioDiretorio + tamanhoDiretorio !== fim) throw new ZipInvalido('diretório central fora do lugar');

  const entradas: EntradaCentral[] = [];
  const nomes = new Set<string>();
  const decodificador = new TextDecoder('utf-8', { fatal: true });
  let soma = 0;
  let i = inicioDiretorio;
  for (let n = 0; n < total; n++) {
    if (i + 46 > fim || lerU32(b, i) !== ASSINATURA_CENTRAL) throw new ZipInvalido('entrada central inválida');
    const flags = lerU16(b, i + 8);
    if (flags & 0x0001) throw new ZipInvalido('entrada cifrada');
    const metodo = lerU16(b, i + 10);
    if (metodo !== 0 && metodo !== 8) throw new ZipInvalido('método de compressão não suportado');
    const crc = lerU32(b, i + 16);
    const compactado = lerU32(b, i + 20);
    const descompactado = lerU32(b, i + 24);
    if (compactado === 0xffffffff || descompactado === 0xffffffff) throw new ZipInvalido('zip64');
    const tamNome = lerU16(b, i + 28);
    const tamExtra = lerU16(b, i + 30);
    const tamComentario = lerU16(b, i + 32);
    const deslocamento = lerU32(b, i + 42);
    const fimEntrada = i + 46 + tamNome + tamExtra + tamComentario;
    if (fimEntrada > fim) throw new ZipInvalido('entrada central truncada');
    let nome: string;
    try {
      nome = decodificador.decode(b.subarray(i + 46, i + 46 + tamNome));
    } catch {
      throw new ZipInvalido('nome de entrada inválido');
    }
    if (nomes.has(nome)) throw new ZipInvalido('entrada repetida');
    nomes.add(nome);

    soma += descompactado;
    if (soma > limites.descompactado) throw new ZipInvalido('conteúdo descompactado grande demais');
    const razao = descompactado / Math.max(compactado, 1);
    if (razao > limites.razao) throw new ZipInvalido('razão de compressão alta demais');
    if (metodo === 0 && compactado !== descompactado) throw new ZipInvalido('entrada sem compressão com tamanhos diferentes');

    entradas.push({ nome, metodo, crc, compactado, descompactado, deslocamento });
    i = fimEntrada;
  }
  if (i !== fim) throw new ZipInvalido('sobra no diretório central');
  return entradas;
}

function dadosDaEntrada(b: Uint8Array, e: EntradaCentral, limiteDados: number): { inicio: number; fim: number } {
  const i = e.deslocamento;
  if (i + 30 > limiteDados || lerU32(b, i) !== ASSINATURA_LOCAL) throw new ZipInvalido('cabeçalho local inválido');
  if (lerU16(b, i + 6) & 0x0001) throw new ZipInvalido('entrada cifrada');
  if (lerU16(b, i + 8) !== e.metodo) throw new ZipInvalido('cabeçalho local diverge do central');
  const inicio = i + 30 + lerU16(b, i + 26) + lerU16(b, i + 28);
  const fim = inicio + e.compactado;
  if (fim > limiteDados) throw new ZipInvalido('dados fora do arquivo');
  return { inicio, fim };
}

/**
 * Valida o zip e devolve as entradas descompactadas, na ordem do diretório central. Qualquer
 * desvio lança ZipInvalido (a mensagem é sempre a mesma; o motivo fica só para log e testes).
 */
export function lerZipSeguro(conteudo: Uint8Array, limites: LimitesZip): Map<string, Uint8Array> {
  if (conteudo.length > limites.bytes) throw new ZipInvalido('arquivo grande demais');
  if (conteudo.length < TAMANHO_FIM + 30 || lerU32(conteudo, 0) !== ASSINATURA_LOCAL) throw new ZipInvalido('não é zip');
  const entradas = lerDiretorio(conteudo, limites);
  const limiteDados = lerU32(conteudo, acharFim(conteudo) + 16);

  // Duas entradas não podem apontar para os mesmos bytes (zip "sobreposto" multiplica o conteúdo).
  const faixas = entradas
    .map((e) => ({ e, ...dadosDaEntrada(conteudo, e, limiteDados) }))
    .sort((a, b) => a.e.deslocamento - b.e.deslocamento);
  for (let k = 1; k < faixas.length; k++) {
    if (faixas[k]!.e.deslocamento < faixas[k - 1]!.fim) throw new ZipInvalido('entradas sobrepostas');
  }

  const saida = new Map<string, Uint8Array>();
  for (const { e, inicio, fim } of faixas.sort((a, b) => entradas.indexOf(a.e) - entradas.indexOf(b.e))) {
    const bruto = conteudo.subarray(inicio, fim);
    let dados: Uint8Array;
    if (e.metodo === 0) {
      dados = bruto;
    } else {
      try {
        // Teto de saída = tamanho declarado: o tamanho mentiroso para aqui, sem alocar além dele.
        dados = inflateRawSync(bruto, { maxOutputLength: Math.max(e.descompactado, 1) });
      } catch {
        throw new ZipInvalido('falha ao descompactar');
      }
    }
    if (dados.length !== e.descompactado) throw new ZipInvalido('tamanho real diferente do declarado');
    if (crc32(dados) >>> 0 !== e.crc) throw new ZipInvalido('crc não confere');
    saida.set(e.nome, dados);
  }
  return saida;
}

/** Zip sem compressão (método 0) com as entradas dadas, na ordem dada. */
export function empacotarSemCompressao(entradas: Iterable<[string, Uint8Array]>): Uint8Array {
  const codificador = new TextEncoder();
  const locais: Uint8Array[] = [];
  const centrais: Uint8Array[] = [];
  let deslocamento = 0;
  let quantidade = 0;
  for (const [nome, dados] of entradas) {
    const n = codificador.encode(nome);
    const crc = crc32(dados) >>> 0;
    const local = Buffer.alloc(30 + n.length);
    local.writeUInt32LE(ASSINATURA_LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nome em UTF-8
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dados.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(n.length, 26);
    local.set(n, 30);
    const central = Buffer.alloc(46 + n.length);
    central.writeUInt32LE(ASSINATURA_CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(dados.length, 20);
    central.writeUInt32LE(dados.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(deslocamento, 42);
    central.set(n, 46);
    locais.push(local, dados);
    centrais.push(central);
    deslocamento += local.length + dados.length;
    quantidade++;
  }
  const tamanhoCentral = centrais.reduce((t, c) => t + c.length, 0);
  const fim = Buffer.alloc(TAMANHO_FIM);
  fim.writeUInt32LE(ASSINATURA_FIM, 0);
  fim.writeUInt16LE(quantidade, 8);
  fim.writeUInt16LE(quantidade, 10);
  fim.writeUInt32LE(tamanhoCentral, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...locais, ...centrais, fim]);
}
