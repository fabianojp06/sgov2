import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { lerMapaFrentes, verificarFrentes, type MapaFrentes } from './verificar';

// Mapa de teste igual ao .github/frentes.yml (spec §12.3).
const mapa: MapaFrentes = lerMapaFrentes(
  fileURLToPath(new URL('../../.github/frentes.yml', import.meta.url)),
);

describe('verificarFrentes', () => {
  it('acusa arquivo da outra frente sem a label toca-outra-frente', () => {
    expect(verificarFrentes({ arquivos: ['src/modules/orc/x.ts'], labels: [], frente: 'B', mapa })).toEqual([
      { tipo: 'outra-frente', arquivo: 'src/modules/orc/x.ts' },
    ]);
  });

  it('aceita arquivo da outra frente com a label toca-outra-frente', () => {
    expect(
      verificarFrentes({ arquivos: ['src/modules/orc/x.ts'], labels: ['toca-outra-frente'], frente: 'B', mapa }),
    ).toEqual([]);
  });

  it('acusa arquivo compartilhado sem a label compartilhado', () => {
    expect(verificarFrentes({ arquivos: ['package.json'], labels: [], frente: 'A', mapa })).toEqual([
      { tipo: 'compartilhado', arquivo: 'package.json' },
    ]);
  });

  it('acusa PR compartilhado que também mexe em código de funcionalidade', () => {
    expect(
      verificarFrentes({
        arquivos: ['package.json', 'src/modules/orc/a.ts'],
        labels: ['compartilhado'],
        frente: 'A',
        mapa,
      }),
    ).toEqual([{ tipo: 'compartilhado-misturado', arquivo: 'src/modules/orc/a.ts' }]);
  });

  it('o guarda de fronteira (pr.yml e ops/ci) é compartilhado, mesmo dentro das pastas da frente B (#179)', () => {
    const arquivos = ['.github/workflows/pr.yml', 'ops/ci/vinculo-pr.sh', 'ops/ci/testes/vinculo-pr.bats'];
    expect(verificarFrentes({ arquivos, labels: [], frente: 'B', mapa })).toEqual(
      arquivos.map((arquivo) => ({ tipo: 'compartilhado', arquivo })),
    );
    expect(verificarFrentes({ arquivos: ['.github/workflows/ci.yml', 'ops/vps/x.sh'], labels: [], frente: 'B', mapa })).toEqual([]);
  });

  it('acusa mais de uma migration no mesmo PR', () => {
    const violacoes = verificarFrentes({
      arquivos: [
        'prisma/migrations/202611010000_orc_a/migration.sql',
        'prisma/migrations/202611010001_orc_b/migration.sql',
      ],
      labels: [],
      frente: 'A',
      mapa,
    });
    expect(violacoes).toContainEqual({ tipo: 'migration-multipla' });
  });

  it('deixa a memória do projeto livre para as duas frentes', () => {
    expect(
      verificarFrentes({ arquivos: ['docs/memoria/memoria-do-projeto.md'], labels: [], frente: 'B', mapa }),
    ).toEqual([]);
  });

  // Casos complementares do mapa da spec §12.3.
  it('aceita uma única migration junto com o código do próprio módulo', () => {
    expect(
      verificarFrentes({
        arquivos: ['prisma/migrations/202611010000_orc_a/migration.sql', 'prisma/schema/orc.prisma', 'src/modules/orc/a.ts'],
        labels: [],
        frente: 'A',
        mapa,
      }),
    ).toEqual([]);
  });

  it('respeita as rotas por módulo, o proxy.ts e o arquivo fora de todos os globs', () => {
    expect(
      verificarFrentes({
        arquivos: ['src/app/(sistema)/cad/page.tsx', 'src/proxy.ts', 'arquivo-novo.txt'],
        labels: [],
        frente: 'B',
        mapa,
      }),
    ).toEqual([
      { tipo: 'outra-frente', arquivo: 'src/proxy.ts' },
      { tipo: 'compartilhado', arquivo: 'arquivo-novo.txt' },
    ]);
  });

  // Núcleo de configuração, banco e filas e o helper de integração são da frente A (spec §12.3).
  it.each(['src/shared/config/env.ts', 'src/shared/db/prisma.ts', 'src/shared/filas/index.ts', 'tests/integracao/banco.ts', 'tests/integracao/apoio/x.ts', 'prisma/schema/nucleo.prisma'])(
    '%s é da frente A',
    (arquivo) => {
      expect(verificarFrentes({ arquivos: [arquivo], labels: [], frente: 'A', mapa })).toEqual([]);
      expect(verificarFrentes({ arquivos: [arquivo], labels: [], frente: 'B', mapa })).toEqual([
        { tipo: 'outra-frente', arquivo },
      ]);
    },
  );

  it('teste de integração de módulo da frente B fica com o dono do módulo', () => {
    expect(
      verificarFrentes({ arquivos: ['src/modules/cad/infrastructure/repo.int.test.ts'], labels: [], frente: 'B', mapa }),
    ).toEqual([]);
  });
});

// #150 (revisão do PR #149): a leitura do mapa com campo inválido ou ausente e a CLI com os códigos de saída.
describe('lerMapaFrentes', () => {
  const comMapa = (yaml: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'frentes-'));
    const caminho = join(dir, 'frentes.yml');
    writeFileSync(caminho, yaml);
    return caminho;
  };

  it('campo ausente vira lista vazia; campo que não é lista de texto é recusado com o nome do campo', () => {
    expect(lerMapaFrentes(comMapa('frentes:\n  A: ["src/a/**"]\n'))).toEqual({ frentes: { A: ['src/a/**'], B: [] }, compartilhados: [], livres: [], migrations: [] });
    expect(() => lerMapaFrentes(comMapa('frentes:\n  A: "src/a/**"\n'))).toThrow('o campo "frentes.A" deve ser uma lista de globs');
    expect(() => lerMapaFrentes(comMapa('compartilhados: [1, 2]\n'))).toThrow('o campo "compartilhados"');
  });
});

describe('CLI do verificador', () => {
  const cli = fileURLToPath(new URL('./verificar.ts', import.meta.url));
  const rodar = (args: string[], arquivos: string[]) =>
    spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], { input: arquivos.join('\n'), encoding: 'utf8', cwd: fileURLToPath(new URL('../..', import.meta.url)) });

  it('sai com 0 sem violação, 1 com violação (listada) e 2 sem a frente', () => {
    const ok = rodar(['--frente', 'A', '--labels', 'frente:A'], ['src/modules/orc/x.ts']);
    expect([ok.status, ok.stdout]).toEqual([0, expect.stringContaining('nenhuma violação (1 arquivo(s), frente A)')]);
    const violou = rodar(['--frente', 'B'], ['src/modules/orc/x.ts']);
    expect(violou.status).toBe(1);
    expect(violou.stderr).toContain('arquivo da outra frente sem a label "toca-outra-frente": src/modules/orc/x.ts');
    expect(rodar([], []).status).toBe(2);
  }, 30_000);
});
