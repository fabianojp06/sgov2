import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Fronteiras de módulo (spec §4.1): domain só vê o próprio módulo e o kernel;
// entre módulos só pelo index.ts; app/ não toca Prisma; domain/ não faz I/O.
const eslint = new ESLint();

describe('fronteiras de módulo', () => {
  it.each([
    ['src/modules/orc/domain/a.ts', "import { x } from '@/modules/cad/infrastructure/repo';", true],
    ['src/modules/orc/application/a.ts', "import { x } from '@/modules/cad/domain/conta';", true],
    ['src/modules/orc/application/a.ts', "import { x } from '@/modules/cad';", false],
    ['src/modules/orc/domain/a.ts', "import { Dinheiro } from '@/shared/kernel';", false],
    ['src/modules/orc/domain/a.ts', "import { prisma } from '@/shared/db';", true],
    ['src/app/x/page.tsx', "import { prisma } from '@/shared/db';", true],
    ['src/app/x/page.tsx', "import { PrismaClient } from '@/generated/prisma/client';", true],
    // Casos complementares: dentro do próprio módulo vale; app/ usa só o index.ts.
    ['src/modules/orc/application/a.ts', "import { x } from '@/modules/orc/domain/conta';", false],
    ['src/modules/orc/domain/a.ts', "import { x } from '@/modules/orc/infrastructure/repo';", true],
    ['src/app/x/page.tsx', "import { x } from '@/modules/orc';", false],
    ['src/app/x/page.tsx', "import { x } from '@/modules/orc/infrastructure/repo';", true],
    // Só o index.ts é público: o resto da raiz do módulo (arquivos e pastas fora das camadas) é privado.
    ['src/modules/orc/application/a.ts', "import { x } from '@/modules/cad/repo';", true],
    ['src/modules/orc/application/a.ts', "import { x } from '@/modules/cad/lib/repo';", true],
    ['src/modules/orc/application/a.ts', "import { x } from '@/modules/cad/index';", false],
    ['src/app/x/page.tsx', "import { x } from '@/modules/cad/lib/repo';", true],
    ['src/app/x/page.tsx', "import { x } from '@/modules/cad/servicos/repo';", true],
    ['src/modules/cad/application/a.ts', "import { x } from '@/modules/cad/lib/repo';", false],
    // Segunda entrada pública, só de servidor (plano do P4, R22): worker, seed e outros módulos.
    ['src/modules/orc/application/a.ts', "import { x } from '@/modules/cad/servidor';", false],
    ['src/app/x/page.tsx', "import { x } from '@/modules/cad/servidor';", false],
    ['src/modules/orc/application/a.ts', "import { x } from '@/modules/cad/servidores';", true],
    ['src/modules/orc/application/a.ts', "import { x } from '@/modules/cad/lib/servidor';", true],
    ['src/modules/orc/application/a.ts', "import { x } from '@/modules/cad/infrastructure/servidor';", true],
    // Dependências externas: app/ não usa Prisma nem pg; domain/ não faz I/O.
    ['src/app/x/page.tsx', "import { PrismaClient } from '@prisma/client';", true],
    ['src/app/x/page.tsx', "import { PrismaPg } from '@prisma/adapter-pg';", true],
    ['src/app/x/page.tsx', "import { Pool } from 'pg';", true],
    ['src/app/x/page.tsx', "import { redirect } from 'next/navigation';", false],
    ['src/modules/orc/domain/a.ts', "import { PrismaClient } from '@prisma/client';", true],
    ['src/modules/orc/domain/a.ts', "import { Pool } from 'pg';", true],
    ['src/modules/orc/domain/a.ts', "import { PgBoss } from 'pg-boss';", true],
    ['src/modules/orc/domain/a.ts', "import { readFileSync } from 'node:fs';", true],
    ['src/modules/orc/domain/a.ts', "import { readFile } from 'fs/promises';", true],
    ['src/modules/orc/domain/a.ts', "import { headers } from 'next/headers';", true],
    ['src/modules/orc/infrastructure/a.ts', "import { PrismaClient } from '@prisma/client';", false],
  ])('%s importando (%s) → erro=%s', async (arquivo, codigo, deveFalhar) => {
    const [r] = await eslint.lintText(codigo, { filePath: arquivo });
    expect(r).toBeDefined();
    // Só conta erros de fronteira (boundaries/* e no-restricted-imports):
    // o import de teste não é usado e geraria no-unused-vars.
    const erros = r!.messages.filter(
      (m) => m.severity === 2 && (m.ruleId?.startsWith('boundaries/') || m.ruleId === 'no-restricted-imports'),
    );
    expect(erros.length > 0, JSON.stringify(r!.messages)).toBe(deveFalhar);
  });
});

// Dinheiro nunca passa por number (spec §5, D5): domain/ e kernel/ não usam as
// funções que arredondam ou convertem number. O Decimal.toFixed fica só em kernel/decimal.ts.
describe('number para dinheiro', () => {
  it.each([
    ['src/modules/orc/domain/a.ts', 'export const x = Math.round(1.5);', true],
    ['src/modules/orc/domain/a.ts', "export const x = parseFloat('1.5');", true],
    ['src/modules/orc/domain/a.ts', "export const x = Number.parseFloat('1.5');", true],
    ['src/modules/orc/domain/a.ts', 'export const f = (v: number) => v.toFixed(2);', true],
    ['src/shared/kernel/dinheiro.ts', 'export const x = Math.round(1.5);', true],
    ['src/shared/kernel/dinheiro.ts', 'export const f = (v: { toFixed(n: number): string }) => v.toFixed(2);', true],
    ['src/shared/kernel/decimal.ts', 'export const f = (v: { toFixed(n: number): string }) => v.toFixed(2);', false],
    ['src/modules/orc/application/a.ts', 'export const x = Math.round(1.5);', false],
    ['src/modules/orc/domain/a.ts', 'export const x = Math.max(1, 2);', false],
  ])('%s com (%s) → erro=%s', async (arquivo, codigo, deveFalhar) => {
    const [r] = await eslint.lintText(codigo, { filePath: arquivo });
    const erros = r!.messages.filter(
      (m) => m.severity === 2 && (m.ruleId === 'no-restricted-syntax' || m.ruleId === 'no-restricted-properties'),
    );
    expect(erros.length > 0, JSON.stringify(r!.messages)).toBe(deveFalhar);
    if (deveFalhar) expect(erros[0]!.message).toContain('Use Dinheiro/Percentual (spec §5)');
  });
});
