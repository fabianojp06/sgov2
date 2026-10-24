import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Fronteiras de módulo (spec §4.1): domain só vê o próprio módulo e o kernel;
// entre módulos só pelo index.ts; app/ não toca Prisma.
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
  ])('%s importando (%s) → erro=%s', async (arquivo, codigo, deveFalhar) => {
    const [r] = await eslint.lintText(codigo, { filePath: arquivo });
    expect(r).toBeDefined();
    // Só conta erros de fronteira: o import de teste não é usado e geraria no-unused-vars.
    const erros = r!.messages.filter((m) => m.severity === 2 && m.ruleId?.startsWith('boundaries/'));
    expect(erros.length > 0, JSON.stringify(r!.messages)).toBe(deveFalhar);
  });
});
