import { execFileSync } from 'node:child_process';
import { createWriteStream, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeflateRaw, crc32, deflateRawSync } from 'node:zlib';
import { build } from 'esbuild';
import { afterAll, describe, expect, it } from 'vitest';
import { empacotarSemCompressao, lerZipSeguro, ZipInvalido, type LimitesZip } from './zip-seguro';

// Leitor defensivo de zip (plano do P4, R4, Review Focus 4). Os zips adversos são montados à mão.
const LIMITES: LimitesZip = { bytes: 1024 * 1024, entradas: 50, descompactado: 20 * 1024 * 1024, razao: 100 };
const texto = (s: string) => new TextEncoder().encode(s);

type EntradaTeste = {
  nome: string;
  comprimido: Uint8Array;
  metodo?: number;
  crc: number;
  descompactado: number;
  flags?: number;
};

// Monta um zip com os campos que quisermos, inclusive mentirosos.
function montarZip(entradas: EntradaTeste[], opcoes: { deslocamentos?: (i: number, real: number) => number } = {}): Uint8Array {
  const partes: Buffer[] = [];
  const centrais: Buffer[] = [];
  let pos = 0;
  entradas.forEach((e, i) => {
    const n = Buffer.from(e.nome);
    const local = Buffer.alloc(30 + n.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(e.flags ?? 0, 6);
    local.writeUInt16LE(e.metodo ?? 8, 8);
    local.writeUInt32LE(e.crc, 14);
    local.writeUInt32LE(e.comprimido.length, 18);
    local.writeUInt32LE(e.descompactado, 22);
    local.writeUInt16LE(n.length, 26);
    n.copy(local, 30);
    const central = Buffer.alloc(46 + n.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(e.flags ?? 0, 8);
    central.writeUInt16LE(e.metodo ?? 8, 10);
    central.writeUInt32LE(e.crc, 16);
    central.writeUInt32LE(e.comprimido.length, 20);
    central.writeUInt32LE(e.descompactado, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(opcoes.deslocamentos ? opcoes.deslocamentos(i, pos) : pos, 42);
    n.copy(central, 46);
    partes.push(local, Buffer.from(e.comprimido));
    centrais.push(central);
    pos += local.length + e.comprimido.length;
  });
  const tamCentral = centrais.reduce((t, c) => t + c.length, 0);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(tamCentral, 12);
  fim.writeUInt32LE(pos, 16);
  return Buffer.concat([...partes, ...centrais, fim]);
}

const entrada = (nome: string, dados: Uint8Array): EntradaTeste => ({
  nome,
  comprimido: deflateRawSync(dados),
  crc: crc32(dados) >>> 0,
  descompactado: dados.length,
});

function motivo(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    expect(e).toBeInstanceOf(ZipInvalido);
    expect((e as Error).message).toBe('Planilha inválida ou grande demais.');
    return (e as ZipInvalido).motivo;
  }
  throw new Error('não recusou');
}

describe('lerZipSeguro', () => {
  it('lê um zip válido, com e sem compressão', () => {
    const z = montarZip([entrada('a.xml', texto('<a/>')), { ...entrada('b.txt', texto('oi')), metodo: 0, comprimido: texto('oi') }]);
    const r = lerZipSeguro(z, LIMITES);
    expect([...r.keys()]).toEqual(['a.xml', 'b.txt']);
    expect(new TextDecoder().decode(r.get('a.xml'))).toBe('<a/>');
  });

  it('o reempacotado sem compressão é lido de volta igual', () => {
    const original = new Map([
      ['x/1.xml', texto('<x>1</x>')],
      ['y.bin', new Uint8Array([0, 1, 2, 255])],
    ]);
    const r = lerZipSeguro(empacotarSemCompressao(original), LIMITES);
    expect([...r.entries()].map(([n, d]) => [n, Buffer.from(d).toString('hex')])).toEqual(
      [...original.entries()].map(([n, d]) => [n, Buffer.from(d).toString('hex')]),
    );
  });

  it('arquivo sem PK\\x03\\x04 é recusado', () => {
    expect(motivo(() => lerZipSeguro(texto('isto não é um zip, só texto qualquer com tamanho'), LIMITES))).toBe('não é zip');
  });

  it('1 MB + 1 byte é recusado sem abrir', () => {
    const grande = new Uint8Array(LIMITES.bytes + 1);
    expect(motivo(() => lerZipSeguro(grande, LIMITES))).toBe('arquivo grande demais');
  });

  it('51 entradas é recusado', () => {
    const z = montarZip(Array.from({ length: 51 }, (_, i) => entrada(`e${i}.txt`, texto('x'))));
    expect(motivo(() => lerZipSeguro(z, LIMITES))).toBe('entradas demais');
  });

  it('soma descompactada acima de 20 MB, pelo declarado, é recusada antes de inflar', () => {
    const dados = new Uint8Array(11 * 1024 * 1024);
    const z = montarZip([entrada('a', dados), entrada('b', dados)]);
    expect(z.length).toBeLessThan(LIMITES.bytes);
    expect(motivo(() => lerZipSeguro(z, { ...LIMITES, razao: Number.POSITIVE_INFINITY }))).toBe('conteúdo descompactado grande demais');
  });

  it('razão de compressão acima de 100 é recusada', () => {
    const z = montarZip([entrada('zeros', new Uint8Array(1024 * 1024))]);
    expect(motivo(() => lerZipSeguro(z, LIMITES))).toBe('razão de compressão alta demais');
  });

  it('tamanho declarado mentiroso (1 KB declarado, 30 MB reais) para no maxOutputLength', () => {
    const real = new Uint8Array(30 * 1024 * 1024);
    const e = entrada('mentira', real);
    const z = montarZip([{ ...e, descompactado: 1024 }]);
    expect(motivo(() => lerZipSeguro(z, { ...LIMITES, razao: Number.POSITIVE_INFINITY }))).toBe('falha ao descompactar');
  });

  it('tamanho declarado maior que o real é recusado', () => {
    const e = entrada('a', texto('abc'));
    expect(motivo(() => lerZipSeguro(montarZip([{ ...e, descompactado: 4 }]), LIMITES))).toBe('tamanho real diferente do declarado');
  });

  it('CRC errado é recusado', () => {
    const e = entrada('a', texto('abc'));
    expect(motivo(() => lerZipSeguro(montarZip([{ ...e, crc: e.crc ^ 1 }]), LIMITES))).toBe('crc não confere');
  });

  it('entrada repetida, cifrada ou com método desconhecido é recusada', () => {
    const e = entrada('a', texto('abc'));
    expect(motivo(() => lerZipSeguro(montarZip([e, e]), LIMITES))).toBe('entrada repetida');
    expect(motivo(() => lerZipSeguro(montarZip([{ ...e, flags: 1 }]), LIMITES))).toBe('entrada cifrada');
    expect(motivo(() => lerZipSeguro(montarZip([{ ...e, metodo: 12 }]), LIMITES))).toBe('método de compressão não suportado');
  });

  it('duas entradas apontando para os mesmos bytes (zip sobreposto) são recusadas', () => {
    const z = montarZip([entrada('a', texto('abc')), entrada('b', texto('abc'))], { deslocamentos: () => 0 });
    expect(motivo(() => lerZipSeguro(z, LIMITES))).toBe('entradas sobrepostas');
  });

  // Campos do fim do diretório central: 4 número do disco, 6 disco do diretório, 8 e 10 contagens,
  // 12 tamanho e 16 início do diretório.
  const comFim = (z: Uint8Array, mexer: (fim: Buffer) => void): Uint8Array => {
    const b = Buffer.from(z);
    mexer(b.subarray(b.length - 22));
    return b;
  };

  it('zip64, vários volumes e diretório fora do lugar são recusados', () => {
    const z = montarZip([entrada('a', texto('abc'))]);
    expect(motivo(() => lerZipSeguro(comFim(z, (f) => (f.writeUInt16LE(0xffff, 8), f.writeUInt16LE(0xffff, 10))), LIMITES))).toBe('zip64');
    expect(motivo(() => lerZipSeguro(comFim(z, (f) => f.writeUInt16LE(1, 4)), LIMITES))).toBe('zip em vários volumes');
    expect(motivo(() => lerZipSeguro(comFim(z, (f) => f.writeUInt32LE(f.readUInt32LE(16) - 1, 16)), LIMITES))).toBe('diretório central fora do lugar');
    const e = entrada('a', texto('abc'));
    expect(motivo(() => lerZipSeguro(montarZip([{ ...e, descompactado: 0xffffffff }]), LIMITES))).toBe('zip64');
  });

  it('sem compressão com tamanhos diferentes, nome UTF-8 inválido e cabeçalho local divergente são recusados', () => {
    const dados = texto('abc');
    expect(motivo(() => lerZipSeguro(montarZip([{ nome: 'a', comprimido: dados, metodo: 0, crc: crc32(dados) >>> 0, descompactado: 4 }]), LIMITES))).toBe(
      'entrada sem compressão com tamanhos diferentes',
    );
    const invalido = Buffer.from(montarZip([entrada('ab', dados)]));
    // O nome no diretório central: troca o primeiro byte por um byte UTF-8 inválido.
    invalido[invalido.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 46] = 0xff;
    expect(motivo(() => lerZipSeguro(invalido, LIMITES))).toBe('nome de entrada inválido');
    const divergente = Buffer.from(montarZip([entrada('a', dados)]));
    divergente.writeUInt16LE(0, 8); // método no cabeçalho local
    expect(motivo(() => lerZipSeguro(divergente, LIMITES))).toBe('cabeçalho local diverge do central');
  });

  it('lixo depois do fim do diretório é recusado', () => {
    const z = montarZip([entrada('a', texto('abc'))]);
    const comLixo = Buffer.concat([Buffer.from(z), Buffer.from('lixo')]);
    expect(motivo(() => lerZipSeguro(comLixo, LIMITES))).toBe('sem fim do diretório central');
  });
});

describe('zip bomb num processo com 256 MB de heap', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'sgo-zip-'));
  afterAll(() => rmSync(pasta, { recursive: true, force: true }));

  // 1 GB de zeros, compactado em streaming (sem 1 GB na memória do teste).
  async function deflate1Gb(): Promise<{ comprimido: Uint8Array; crc: number }> {
    const bloco = Buffer.alloc(1024 * 1024);
    let crc = 0;
    const partes: Buffer[] = [];
    const d = createDeflateRaw({ level: 9 });
    d.on('data', (p: Buffer) => partes.push(p));
    const fim = new Promise<void>((ok) => d.on('end', ok));
    for (let i = 0; i < 1024; i++) {
      crc = crc32(bloco, crc);
      if (!d.write(bloco)) await new Promise((ok) => d.once('drain', ok));
    }
    d.end();
    await fim;
    return { comprimido: Buffer.concat(partes), crc: crc >>> 0 };
  }

  it('recusa sem estourar a memória, com o tamanho honesto e com o mentiroso', async () => {
    const { comprimido, crc } = await deflate1Gb();
    expect(comprimido.length).toBeLessThan(LIMITES.bytes);
    const honesto = montarZip([{ nome: 'bomba', comprimido, crc, descompactado: 1024 * 1024 * 1024 }]);
    const mentiroso = montarZip([{ nome: 'bomba', comprimido, crc, descompactado: 1024 }]);
    for (const [nome, z] of [
      ['honesto.zip', honesto],
      ['mentiroso.zip', mentiroso],
    ] as const) {
      await new Promise<void>((ok, erro) => createWriteStream(join(pasta, nome)).on('error', erro).end(z, ok));
    }
    const leitor = join(pasta, 'leitor.mjs');
    await build({
      entryPoints: ['src/modules/ger/infrastructure/zip-seguro.ts'],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: leitor,
      logLevel: 'warning',
    });
    const roteiro = `
      import { readFileSync } from 'node:fs';
      import { lerZipSeguro } from ${JSON.stringify(leitor)};
      const limites = ${JSON.stringify(LIMITES)};
      for (const nome of ['honesto.zip', 'mentiroso.zip']) {
        try { lerZipSeguro(readFileSync(${JSON.stringify(pasta)} + '/' + nome), { ...limites, razao: nome === 'mentiroso.zip' ? Infinity : limites.razao }); console.log(nome, 'aceito'); }
        catch (e) { console.log(nome, e.name, e.motivo); }
      }
      console.log('rss', Math.round(process.memoryUsage().rss / 1048576));
    `;
    const saida = execFileSync(process.execPath, ['--max-old-space-size=256', '--input-type=module', '-e', roteiro], {
      encoding: 'utf8',
    });
    expect(saida).toContain('honesto.zip ZipInvalido conteúdo descompactado grande demais');
    expect(saida).toContain('mentiroso.zip ZipInvalido falha ao descompactar');
    // O Buffer da descompactação fica fora do heap do V8: o teto de 256 MB sozinho não provaria
    // nada. A memória residente do processo é que mostra que nada perto de 1 GB foi alocado.
    expect(Number(/rss (\d+)/.exec(saida)?.[1])).toBeLessThan(200);
  }, 120_000);
});
