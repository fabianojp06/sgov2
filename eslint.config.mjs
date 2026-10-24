// Configuração do ESLint (flat config, ESLint 10).
// Fronteiras de módulo da spec §4.1, impostas por eslint-plugin-boundaries:
// - domain/ só importa o próprio módulo e shared/kernel;
// - entre módulos, só pelo index.ts do outro módulo;
// - app/ não importa src/generated (Prisma) nem src/shared/db.
// Dependências externas (pacotes) ficam com no-restricted-imports por bloco de files:
// - app/ não importa @prisma/*, pg nem o client gerado;
// - domain/ não faz I/O: sem @prisma/*, pg, pg-boss, next nem módulos nativos do Node.
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

const raiz = fileURLToPath(new URL('.', import.meta.url));

// Tudo o que fica dentro de um módulo, exceto o index.ts da raiz, é privado para os outros módulos.
const CAMADAS = ['mod-domain', 'mod-application', 'mod-infrastructure', 'mod-ui'];
const MODULO = [...CAMADAS, 'mod-raiz'];
// A API pública: o arquivo index.ts na raiz do módulo (caminho relativo ao elemento mod-raiz).
const INDEX = { type: 'mod-raiz', fileInternalPath: 'index.ts' };
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
            // Entre módulos: tudo de outro módulo é privado, exceto o index.ts da raiz.
            {
              from: { element: { type: ['app', 'shared', 'kernel', ...MODULO] } },
              disallow: { to: { element: { type: MODULO } } },
              message: 'Um módulo só pode ser importado pelo index.ts dele (spec §4.1).',
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
);
