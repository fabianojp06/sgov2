// Configuração do ESLint (flat config, ESLint 10).
// Fronteiras de módulo da spec §4.1, impostas por eslint-plugin-boundaries:
// - domain/ só importa o próprio módulo e shared/kernel;
// - entre módulos, só pelo index.ts do outro módulo;
// - app/ não importa src/generated (Prisma) nem src/shared/db.
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

const raiz = fileURLToPath(new URL('.', import.meta.url));

const CAMADAS = ['mod-domain', 'mod-application', 'mod-infrastructure', 'mod-ui'];
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
        // Raiz do módulo (index.ts, a API pública): vem depois das camadas para não engolir as pastas.
        { type: 'mod-index', pattern: 'src/modules/*', capture: ['modulo'] },
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
            // Entre módulos: as camadas internas de outro módulo são privadas.
            {
              from: { element: { type: ['app', 'shared', 'kernel', 'mod-index', ...CAMADAS] } },
              disallow: { to: { element: { type: CAMADAS } } },
              message: 'Um módulo só pode ser importado pelo index.ts dele (spec §4.1).',
            },
            {
              from: { element: { type: ['mod-index', ...CAMADAS] } },
              allow: { to: { element: { type: CAMADAS, captured: MESMO_MODULO } } },
            },
            // domain/: só o próprio módulo e o kernel.
            {
              from: { element: { type: 'mod-domain' } },
              disallow: { to: { element: { type: '*' } } },
              message: 'domain/ só importa o próprio módulo e shared/kernel (spec §4.1).',
            },
            {
              from: { element: { type: 'mod-domain' } },
              allow: { to: [{ element: { type: 'kernel' } }, { element: { type: ['mod-domain', 'mod-index'], captured: MESMO_MODULO } }] },
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
);
