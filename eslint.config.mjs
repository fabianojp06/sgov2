// Configuração do ESLint (flat config, ESLint 10).
// Fronteiras de módulo da spec §4.1, impostas por eslint-plugin-boundaries:
// - domain/ só importa o próprio módulo e shared/kernel;
// - entre módulos, só pelo index.ts do outro módulo;
// - app/ não importa src/generated (Prisma) nem src/shared/db.
// Dependências externas (pacotes) ficam com no-restricted-imports por bloco de files:
// - app/ não importa @prisma/*, pg nem o client gerado;
// - domain/ não faz I/O: sem @prisma/*, pg, pg-boss, next nem módulos nativos do Node.
// - domain/ e kernel/ não usam parseFloat, Math.round nem .toFixed para dinheiro (spec §5).
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

const raiz = fileURLToPath(new URL('.', import.meta.url));

const MSG_DINHEIRO = 'Use Dinheiro/Percentual (spec §5): number não serve para dinheiro.';

// Tudo o que fica dentro de um módulo, exceto o index.ts e o servidor.ts da raiz, é privado para os
// outros módulos.
const CAMADAS = ['mod-domain', 'mod-application', 'mod-infrastructure', 'mod-ui'];
const MODULO = [...CAMADAS, 'mod-raiz'];
// A API pública: o index.ts na raiz do módulo e, só para código de servidor (worker, seed, casos de
// uso de outros módulos), o servidor.ts (plano do P4, R22). Caminho relativo ao elemento mod-raiz.
const INDEX = { type: 'mod-raiz', fileInternalPath: ['index.ts', 'servidor.ts'] };
const MESMO_MODULO = { modulo: '{{ from.element.captured.modulo }}' };

export default tseslint.config(
  {
    ignores: ['.next/**', 'node_modules/**', 'src/generated/**', 'coverage/**', 'next-env.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: { URL: 'readonly', process: 'readonly', console: 'readonly' } },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { require: 'readonly', exports: 'writable', module: 'writable', process: 'readonly', __dirname: 'readonly' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'boundaries/root-path': raiz,
      'boundaries/include': ['src/**/*'],
      'boundaries/elements': [
        { type: 'app', pattern: 'src/app' },
        { type: 'generated', pattern: 'src/generated' },
        { type: 'mod-domain', pattern: 'src/modules/*/domain', capture: ['modulo'] },
        { type: 'mod-application', pattern: 'src/modules/*/application', capture: ['modulo'] },
        { type: 'mod-infrastructure', pattern: 'src/modules/*/infrastructure', capture: ['modulo'] },
        { type: 'mod-ui', pattern: 'src/modules/*/ui', capture: ['modulo'] },
        // Raiz do módulo: o index.ts (API pública) e qualquer outro arquivo ou pasta fora das
        // quatro camadas. Vem depois das camadas para não engolir as pastas delas.
        { type: 'mod-raiz', pattern: 'src/modules/*', capture: ['modulo'] },
        { type: 'kernel', pattern: 'src/shared/kernel' },
        { type: 'shared', pattern: 'src/shared/*', capture: ['nome'] },
      ],
      'import/resolver': {
        typescript: { project: './tsconfig.json', alwaysTryTypes: true },
        [fileURLToPath(new URL('./scripts/eslint/resolver-alias.cjs', import.meta.url))]: { raiz },
      },
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          policies: [
            // Entre módulos: tudo de outro módulo é privado, exceto o index.ts e o servidor.ts da raiz.
            {
              from: { element: { type: ['app', 'shared', 'kernel', ...MODULO] } },
              disallow: { to: { element: { type: MODULO } } },
              message: 'Um módulo só pode ser importado pelo index.ts ou pelo servidor.ts dele (spec §4.1).',
            },
            {
              from: { element: { type: ['app', 'shared', 'kernel', ...MODULO] } },
              allow: { to: { element: INDEX } },
            },
            // Dentro do próprio módulo vale tudo (o domain/ é restringido logo abaixo).
            {
              from: { element: { type: MODULO } },
              allow: { to: { element: { type: MODULO, captured: MESMO_MODULO } } },
            },
            // O servidor.ts expõe funções sem a guarda (exigir): só worker, seed e casos de uso de
            // outros módulos. Vem depois da regra do próprio módulo: vale também para a ui/ do mesmo
            // módulo. Páginas, ações de app/ e componentes de ui/ usam o index.ts (R22).
            {
              from: { element: { type: ['app', 'mod-ui'] } },
              disallow: { to: { element: { type: 'mod-raiz', fileInternalPath: 'servidor.ts' } } },
              message: 'O servidor.ts é só para worker, seed e casos de uso; app/ e ui/ importam o index.ts (R22).',
            },
            // domain/: só o próprio módulo e o kernel.
            {
              from: { element: { type: 'mod-domain' } },
              disallow: { to: { element: { type: '*' } } },
              message: 'domain/ só importa o próprio módulo e shared/kernel (spec §4.1).',
            },
            {
              from: { element: { type: 'mod-domain' } },
              allow: {
                to: [
                  { element: { type: 'kernel' } },
                  { element: { type: 'mod-domain', captured: MESMO_MODULO } },
                  { element: { ...INDEX, captured: MESMO_MODULO } },
                ],
              },
            },
            // app/: rotas finas, sem Prisma.
            {
              from: { element: { type: 'app' } },
              disallow: { to: [{ element: { type: 'generated' } }, { element: { type: 'shared', captured: { nome: 'db' } } }] },
              message: 'app/ não acessa o Prisma diretamente; use os casos de uso dos módulos (spec §4.1).',
            },
          ],
        },
      ],
    },
  },
  // app/: sem Prisma também pelos pacotes (spec §4.1).
  {
    files: ['src/app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@prisma/*', 'prisma', 'prisma/*', 'pg', 'pg/*', '@/generated', '@/generated/*', '**/generated/prisma', '**/generated/prisma/*'],
              message: 'app/ não acessa o Prisma diretamente; use os casos de uso dos módulos (spec §4.1).',
            },
          ],
        },
      ],
    },
  },
  // domain/: regras puras, sem I/O (spec §4.1).
  {
    files: ['src/modules/*/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: builtinModules
            .filter((m) => !m.startsWith('_'))
            .map((name) => ({ name, message: 'domain/ não faz I/O: sem módulos nativos do Node (spec §4.1).' })),
          patterns: [
            {
              group: ['node:*', '@prisma/*', 'prisma', 'prisma/*', 'pg', 'pg/*', 'pg-boss', 'pg-boss/*', 'next', 'next/*', '@/generated', '@/generated/*'],
              message: 'domain/ não faz I/O: sem Prisma, banco, filas, Next.js ou módulos nativos do Node (spec §4.1).',
            },
          ],
        },
      ],
    },
  },
  // Dinheiro nunca passa por number (spec §5, D5). O Decimal.toFixed do núcleo fica isolado em
  // kernel/decimal.ts, a única exceção; os testes podem comparar com number.
  {
    files: ['src/modules/*/domain/**/*.{ts,tsx}', 'src/shared/kernel/**/*.{ts,tsx}'],
    ignores: ['src/shared/kernel/decimal.ts', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    rules: {
      // #168: Number(x), +x e Math.floor/ceil/trunc ficam liberados de propósito. No domain/ e no
      // kernel/ eles só convertem inteiros (dia, mês, nível, quantidade): barrá-los pediria 20 exceções
      // sem proteger dinheiro nenhum, que já passa pelo tipo Dinheiro.
      'no-restricted-syntax': [
        'error',
        { selector: "CallExpression[callee.name='parseFloat']", message: MSG_DINHEIRO },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'round', message: MSG_DINHEIRO },
        { object: 'Number', property: 'parseFloat', message: MSG_DINHEIRO },
        { object: 'globalThis', property: 'parseFloat', message: MSG_DINHEIRO },
        { property: 'toFixed', message: MSG_DINHEIRO },
        { property: 'toPrecision', message: MSG_DINHEIRO },
      ],
    },
  },
);
