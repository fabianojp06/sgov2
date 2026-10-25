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
