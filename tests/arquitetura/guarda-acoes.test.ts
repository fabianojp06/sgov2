import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Guarda obrigatória (US-008, spec §11): toda Server Action é criada com definirAcao e todo
// Route Handler com definirRota. A verificação usa a árvore sintática do TypeScript, não regex:
// comentários, strings, vários declaradores e expressões compostas não escapam.
const raiz = process.cwd();
const METODOS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const EXTENSOES = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

function analisar(texto: string, nome = 'arquivo.tsx'): ts.SourceFile {
  return ts.createSourceFile(nome, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

const ehDiretiva = (s: ts.Statement) =>
  ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression) && s.expression.text === 'use server';

const exportado = (s: ts.Statement) =>
  ts.canHaveModifiers(s) && (ts.getModifiers(s) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

const chamada = (e: ts.Expression | undefined, nome: string) =>
  e !== undefined && ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === nome;

// Ação pública (sem sessão, R4 do plano do P5): só o login pode ter, e só as ações `entrar` e
// `solicitarRecuperacaoSenha` (US-029, Task 2 do plano P8).
const ACAO_PUBLICA = 'definirAcaoPublica';
const ARQUIVO_ACAO_PUBLICA = 'src/modules/aut/application/acoes-login.ts';
const NOMES_ACAO_PUBLICA: ReadonlySet<string> = new Set(['entrar', 'solicitarRecuperacaoSenha']);
// Onde o identificador pode aparecer: a ação do login e a própria definição em @/shared/authz.
const PODE_CITAR_ACAO_PUBLICA = new Set([
  ARQUIVO_ACAO_PUBLICA,
  'src/shared/authz/definir-acao-publica.ts',
  'src/shared/authz/definir-acao-publica.test.ts',
  'src/shared/authz/index.ts',
]);

// Problemas de exportação: só `export const x = <fabrica>(...)`, um declarador por nome.
function exportacoes(arquivo: ts.SourceFile, fabrica: string, filtro: (nome: string) => boolean): string[] {
  const problemas: string[] = [];
  for (const s of arquivo.statements) {
    if (ts.isExportDeclaration(s)) {
      if (!s.isTypeOnly) problemas.push(`export { } / export * (use ${fabrica} no próprio arquivo)`);
      continue;
    }
    if (ts.isExportAssignment(s)) {
      problemas.push(`export default sem ${fabrica}`);
      continue;
    }
    if (!exportado(s)) continue;
    if (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) continue;
    if (ts.isVariableStatement(s)) {
      const constante = (s.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const d of s.declarationList.declarations) {
        const nome = ts.isIdentifier(d.name) ? d.name.text : d.name.getText(arquivo);
        if (!ts.isIdentifier(d.name)) problemas.push(`${nome}: exportação por desestruturação`);
        else if (!filtro(nome)) continue;
        else if (!constante) problemas.push(`${nome}: use const`);
        else if (!chamada(d.initializer, fabrica) && !(fabrica === 'definirAcao' && chamada(d.initializer, ACAO_PUBLICA)))
          problemas.push(`${nome} não usa ${fabrica}`);
      }
      continue;
    }
    const nome = (s as { name?: ts.Identifier }).name?.text ?? 'default';
    if (filtro(nome)) problemas.push(`${nome}: declarado sem ${fabrica}`);
  }
  return problemas;
}

function diretivasInternas(arquivo: ts.SourceFile): number {
  let total = 0;
  const visitar = (n: ts.Node): void => {
    if ((ts.isBlock(n) || ts.isModuleBlock(n)) && n.statements.some(ehDiretiva)) total++;
    ts.forEachChild(n, visitar);
  };
  ts.forEachChild(arquivo, visitar);
  return total;
}

function citaIdentificador(arquivo: ts.SourceFile, nome: string): boolean {
  let achou = false;
  const visitar = (n: ts.Node): void => {
    if (achou) return;
    if (ts.isIdentifier(n) && n.text === nome) achou = true;
    else ts.forEachChild(n, visitar);
  };
  ts.forEachChild(arquivo, visitar);
  return achou;
}

// Ações públicas exportadas com outro nome além dos permitidos.
function acoesPublicasExtras(arquivo: ts.SourceFile): string[] {
  return arquivo.statements.flatMap((s) =>
    ts.isVariableStatement(s) && exportado(s)
      ? s.declarationList.declarations
          .filter((d) => chamada(d.initializer, ACAO_PUBLICA) && !(ts.isIdentifier(d.name) && NOMES_ACAO_PUBLICA.has(d.name.text)))
          .map((d) => `${d.name.getText(arquivo)}: as únicas ações públicas são ${[...NOMES_ACAO_PUBLICA].join(' e ')}`)
      : [],
  );
}

export function problemasDeAcao(texto: string, caminho?: string): string[] {
  const arquivo = analisar(texto);
  const problemas: string[] = [];
  if (diretivasInternas(arquivo) > 0) problemas.push("'use server' fora do topo do arquivo (Server Action inline)");
  // Qualquer menção a definirAcaoPublica fora do lugar permitido, com ou sem 'use server'.
  if (citaIdentificador(arquivo, ACAO_PUBLICA) && !PODE_CITAR_ACAO_PUBLICA.has(caminho ?? '')) {
    problemas.push(`${ACAO_PUBLICA} só em ${ARQUIVO_ACAO_PUBLICA}`);
  }
  if (caminho === ARQUIVO_ACAO_PUBLICA) problemas.push(...acoesPublicasExtras(arquivo));
  const prologo = arquivo.statements.findIndex((s) => !(ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression)));
  const topo = arquivo.statements.slice(0, prologo === -1 ? undefined : prologo);
  if (!topo.some(ehDiretiva)) return problemas;
  return [...problemas, ...exportacoes(arquivo, 'definirAcao', () => true)];
}

// Página do sistema (P5): o export default é uma função async cujo corpo começa com
// `await exigirPagina(...)`, solto ou atribuído a uma constante. A guarda do layout não basta:
// na navegação entre páginas irmãs, o App Router não renderiza o layout de novo.
// default.tsx entra porque, nas rotas paralelas (@slot), ele é renderizado como página.
export const ehPaginaDoSistema = (caminho: string) =>
  /^src\/app\/\(sistema\)\/(.+\/)?(page|default)\.(tsx|ts|jsx|js)$/.test(caminho);

// Páginas fora de (sistema), sem a guarda de sessão: só as públicas previstas (C32, P5).
export const PAGINAS_PUBLICAS = new Set(['src/app/page.tsx', 'src/app/login/page.tsx', 'src/app/troca-senha/page.tsx']);
const ehPagina = (caminho: string) => /^src\/app\/(.+\/)?(page|default)\.(tsx|ts|jsx|js)$/.test(caminho);

// exigirPagina tem de vir da guarda real, não de um falso local.
const importaExigirPagina = (arquivo: ts.SourceFile) =>
  arquivo.statements.some(
    (s) =>
      ts.isImportDeclaration(s) &&
      ts.isStringLiteral(s.moduleSpecifier) &&
      s.moduleSpecifier.text === '@/shared/authz' &&
      !s.importClause?.isTypeOnly &&
      s.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(s.importClause.namedBindings) &&
      s.importClause.namedBindings.elements.some((e) => e.name.text === 'exigirPagina' && !e.propertyName && !e.isTypeOnly),
  );

// Exports que o Next executa fora do corpo da página (e, portanto, sem a guarda dela).
const EXPORTS_PROIBIDOS = new Set(['generateMetadata', 'generateViewport']);

const ehAwaitExigirPagina = (e: ts.Expression | undefined) =>
  e !== undefined && ts.isAwaitExpression(e) && chamada(e.expression, 'exigirPagina');

export function problemasDePagina(texto: string): string[] {
  const arquivo = analisar(texto);
  const padrao = arquivo.statements.find(
    (s): s is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(s) && (ts.getModifiers(s) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword),
  );
  const assincrona = padrao && (ts.getModifiers(padrao) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
  const primeira = padrao?.body?.statements[0];
  const guardada =
    primeira !== undefined &&
    ((ts.isExpressionStatement(primeira) && ehAwaitExigirPagina(primeira.expression)) ||
      (ts.isVariableStatement(primeira) &&
        primeira.declarationList.declarations.length === 1 &&
        ehAwaitExigirPagina(primeira.declarationList.declarations[0]?.initializer)));
  const problemas = assincrona && guardada ? [] : ['a página do sistema precisa começar com await exigirPagina(...)'];
  if (!importaExigirPagina(arquivo)) problemas.push("exigirPagina precisa ser importado de '@/shared/authz'");
  for (const s of arquivo.statements) {
    if (!exportado(s)) continue;
    const nomes = ts.isVariableStatement(s)
      ? s.declarationList.declarations.map((d) => d.name.getText(arquivo))
      : [(s as { name?: ts.Identifier }).name?.text ?? ''];
    for (const nome of nomes) if (EXPORTS_PROIBIDOS.has(nome)) problemas.push(`${nome} não é permitido em página do sistema`);
  }
  return problemas;
}

// Route Handlers públicos, sem a guarda de sessão: só os previstos e só com GET. O endpoint de saúde
// (US-017) é consultado por um monitor externo, sem sessão, e responde só o estado dos componentes; o
// src/proxy.ts também precisa liberar o caminho no PUBLICAS.
export const ROTAS_PUBLICAS = new Set(['src/app/(sistema)/int/saude/route.ts']);

export function problemasDeRotaPublica(texto: string): string[] {
  const arquivo = analisar(texto);
  const problemas: string[] = [];
  for (const s of arquivo.statements) {
    if (!exportado(s)) continue;
    const nomes = ts.isVariableStatement(s)
      ? s.declarationList.declarations.map((d) => d.name.getText(arquivo))
      : [(s as { name?: ts.Identifier }).name?.text ?? ''];
    for (const nome of nomes) if (METODOS.has(nome) && nome !== 'GET') problemas.push(`rota pública só com GET: ${nome} precisa de definirRota`);
  }
  return problemas;
}

// Regras de um arquivo, pelo caminho relativo com barras normais (o Windows usaria \).
export function problemasDoArquivo(caminho: string, texto: string): string[] {
  const rota = /^route\.\w+$/.test(caminho.split('/').pop() ?? '');
  return [
    ...problemasDeAcao(texto, caminho),
    ...(rota ? (ROTAS_PUBLICAS.has(caminho) ? problemasDeRotaPublica(texto) : problemasDeRota(texto)) : []),
    ...(ehPaginaDoSistema(caminho) ? problemasDePagina(texto) : []),
    ...(ehPagina(caminho) && !ehPaginaDoSistema(caminho) && !PAGINAS_PUBLICAS.has(caminho)
      ? ['página fora de (sistema) sem guarda: mova para src/app/(sistema)/ ou inclua em PAGINAS_PUBLICAS']
      : []),
  ];
}

export function problemasDeRota(texto: string): string[] {
  return exportacoes(analisar(texto), 'definirRota', (nome) => METODOS.has(nome));
}

function listar(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    if (nome === 'node_modules' || nome === 'generated') return [];
    const caminho = join(dir, nome);
    return statSync(caminho).isDirectory() ? listar(caminho) : [caminho];
  });
}

function varrer(dir: string): string[] {
  return listar(dir)
    .filter((a) => EXTENSOES.test(a))
    .flatMap((a) => {
      const caminho = relative(raiz, a).split(sep).join('/');
      return problemasDoArquivo(caminho, readFileSync(a, 'utf8')).map((p) => `${caminho}: ${p}`);
    });
}

const FIXTURES = join(raiz, 'tests/arquitetura/fixtures/guarda');
const fixture = (nome: string) => readFileSync(join(FIXTURES, nome), 'utf8');

describe('guarda obrigatória: verificação contra fixtures', () => {
  it('ação sem guarda é reprovada', () => expect(problemasDeAcao(fixture('acao-sem-guarda.ts'))).not.toEqual([]));
  it('ação com definirAcao passa', () => expect(problemasDeAcao(fixture('acao-com-guarda.ts'))).toEqual([]));
  it('Server Action inline é reprovada', () => {
    expect(problemasDeAcao(fixture('acao-inline.tsx'))).toEqual([
      "'use server' fora do topo do arquivo (Server Action inline)",
    ]);
  });
  it('rota sem guarda é reprovada', () => expect(problemasDeRota(fixture('route-sem-guarda.ts'))).not.toEqual([]));
  it('rota com definirRota passa', () => expect(problemasDeRota(fixture('route-com-guarda.ts'))).toEqual([]));
  it('rota pública: só GET sem guarda; outro método é reprovado', () => {
    expect(problemasDeRotaPublica('export async function GET() { return new Response(); }')).toEqual([]);
    expect(problemasDeRotaPublica('export async function GET() { return new Response(); }\nexport async function POST() { return new Response(); }')).toEqual([
      'rota pública só com GET: POST precisa de definirRota',
    ]);
    expect(problemasDeRotaPublica('export const DELETE = async () => new Response();')).toEqual(['rota pública só com GET: DELETE precisa de definirRota']);
  });
  it('rota fora da lista de públicas continua exigindo definirRota', () => {
    expect(problemasDoArquivo('src/app/(sistema)/int/outra/route.ts', 'export async function GET() { return new Response(); }')).not.toEqual([]);
    expect(problemasDoArquivo('src/app/(sistema)/int/saude/route.ts', 'export async function GET() { return new Response(); }')).toEqual([]);
  });

  it('ação pública só em src/modules/aut/application/acoes-login.ts', () => {
    expect(problemasDeAcao(fixture('acao-publica.ts'), 'src/modules/aut/application/acoes-login.ts')).toEqual([]);
    expect(problemasDeAcao(fixture('acao-publica.ts'), 'src/modules/adm/application/x.ts')).toEqual([
      'definirAcaoPublica só em src/modules/aut/application/acoes-login.ts',
    ]);
    expect(problemasDeAcao(fixture('acao-publica.ts'))).toEqual([
      'definirAcaoPublica só em src/modules/aut/application/acoes-login.ts',
    ]);
  });
  it('acoes-login.ts só exporta entrar e solicitarRecuperacaoSenha como ações públicas', () => {
    const texto = `'use server';\nexport const entrar = definirAcaoPublica(1);\nexport const solicitarRecuperacaoSenha = definirAcaoPublica(2);\nexport const resetar = definirAcaoPublica(3);`;
    expect(problemasDeAcao(texto, 'src/modules/aut/application/acoes-login.ts')).toEqual([
      'resetar: as únicas ações públicas são entrar e solicitarRecuperacaoSenha',
    ]);
  });
  it('definirAcaoPublica citado fora do lugar, mesmo sem use server', () => {
    expect(problemasDeAcao('const x = definirAcaoPublica(1);', 'src/modules/adm/application/y.ts')).toEqual([
      'definirAcaoPublica só em src/modules/aut/application/acoes-login.ts',
    ]);
    expect(problemasDeAcao('export { definirAcaoPublica } from "./x";', 'src/shared/authz/index.ts')).toEqual([]);
  });
  it('página com exigirPagina no início passa', () => expect(problemasDePagina(fixture('pagina-com-guarda.tsx.txt'))).toEqual([]));
  it('exigirPagina de outro lugar é recusado', () =>
    expect(
      problemasDePagina(`import { exigirPagina } from './falso';\nexport default async function P() { await exigirPagina('a', 'consultar'); }`),
    ).toEqual(["exigirPagina precisa ser importado de '@/shared/authz'"]));
  it('generateMetadata em página do sistema é recusado', () =>
    expect(
      problemasDePagina(
        `import { exigirPagina } from '@/shared/authz';\nexport async function generateMetadata() { return {}; }\nexport default async function P() { await exigirPagina('a', 'consultar'); }`,
      ),
    ).toEqual(['generateMetadata não é permitido em página do sistema']));
  it('a composição aplica a regra de página pelo caminho relativo', () => {
    expect(problemasDoArquivo('src/app/(sistema)/x/page.tsx', fixture('pagina-sem-guarda.tsx.txt'))).toContain(
      'a página do sistema precisa começar com await exigirPagina(...)',
    );
    expect(problemasDoArquivo('src/app/(sistema)/x/page.tsx', fixture('pagina-com-guarda.tsx.txt'))).toEqual([]);
    expect(problemasDoArquivo('src/app/(sistema)/@painel/default.tsx', fixture('pagina-sem-guarda.tsx.txt'))).not.toEqual([]);
  });
  it('página fora de (sistema) só na lista de públicas', () => {
    expect(problemasDoArquivo('src/app/login/page.tsx', 'export default function P() { return null; }')).toEqual([]);
    expect(problemasDoArquivo('src/app/relatorio/page.tsx', 'export default function P() { return null; }')).toEqual([
      'página fora de (sistema) sem guarda: mova para src/app/(sistema)/ ou inclua em PAGINAS_PUBLICAS',
    ]);
  });
  it('página sem exigirPagina é reprovada', () => {
    expect(problemasDePagina(fixture('pagina-sem-guarda.tsx.txt'))).toContain(
      'a página do sistema precisa começar com await exigirPagina(...)',
    );
  });
  it.each([
    ['export default async function P() { const x = 1; await exigirPagina("a", "consultar"); }'],
    ['export default function P() { exigirPagina("a", "consultar"); }'],
    ['export default async function P() { exigirPagina("a", "consultar"); }'],
    ['const P = async () => { await exigirPagina("a", "consultar"); };\nexport default P;'],
    ['export const x = 1;'],
  ])('página reprovada: %j', (codigo) => expect(problemasDePagina(codigo)).not.toEqual([]));
  it.each([
    [`import { exigirPagina } from '@/shared/authz';\nexport default async function P() { await exigirPagina("a", "consultar"); return null; }`],
    [`import { exigirPagina } from '@/shared/authz';\nexport default async function P({ params }: { params: Promise<unknown> }) { const ctx = await exigirPagina("a", "consultar"); return ctx; }`],
  ])('página aceita: %j', (codigo) => expect(problemasDePagina(codigo)).toEqual([]));
  it.each([
    ['src/app/(sistema)/adm/usuarios/page.tsx', true],
    ['src/app/(sistema)/inicio/page.tsx', true],
    ['src/app/(sistema)/layout.tsx', false],
    ['src/app/(sistema)/@painel/default.tsx', true],
    ['src/app/login/page.tsx', false],
    ['src/app/troca-senha/page.tsx', false],
  ])('página do sistema: %s → %s', (caminho, esperado) => expect(ehPaginaDoSistema(caminho)).toBe(esperado));

  it('a varredura acha os problemas das fixtures (não passa vazia)', () => {
    const falhas = varrer(FIXTURES);
    expect(falhas.some((f) => f.includes('acao-sem-guarda'))).toBe(true);
    expect(falhas.some((f) => f.includes('acao-inline'))).toBe(true);
    expect(falhas.some((f) => f.includes('acao-publica') && f.includes('definirAcaoPublica só em'))).toBe(true);
  });

  const U = "'use server';\n";
  it.each([
    [`${U}export const a = outraCoisa(1);`, 'a não usa definirAcao'],
    [`${U}export const b = 1;`, 'b não usa definirAcao'],
    [`${U}export default async function x() {}`, 'x: declarado sem definirAcao'],
    [`${U}const c = 1;\nexport { c };`, 'export { } / export * (use definirAcao no próprio arquivo)'],
    [`${U}const c = 1;\nexport{c};`, 'export { } / export * (use definirAcao no próprio arquivo)'],
    [`${U}export const a = definirAcao(1), b = async () => 1;`, 'b não usa definirAcao'],
    [`${U}export const s = definirAcao(1) || outra;`, 's não usa definirAcao'],
    [`${U}export let s = definirAcao(1);`, 's: use const'],
    [`${U}export const { a } = obj;`, '{ a }: exportação por desestruturação'],
    [`${U}export const s = definirAcao;`, 's não usa definirAcao'],
    [`${U}export async function\n  salvar() {}`, 'salvar: declarado sem definirAcao'],
    [`"use server";\nexport const s = 1;`, 's não usa definirAcao'],
    [`/* x */\n'use server';\nexport const s = 1;`, 's não usa definirAcao'],
    [`${U}const t = '/*';\nexport const s = 1;\nconst u = '*/';`, 's não usa definirAcao'],
    [`export const f = async () => { 'use server'; };`, "'use server' fora do topo do arquivo (Server Action inline)"],
  ])('ação: %j → %s', (codigo, problema) => expect(problemasDeAcao(codigo)).toContain(problema));

  it.each([
    [`${U}export const s = definirAcao({}, async () => 1);\nexport type T = string;`],
    [`import x from 'y';\nexport const s = 1;`],
  ])('ação aceita: %j', (codigo) => expect(problemasDeAcao(codigo)).toEqual([]));

  it.each([
    ['export const POST = async () => new Response();', 'POST não usa definirRota'],
    ["export { GET } from './outro';", 'export { } / export * (use definirRota no próprio arquivo)'],
    ['export const GET = definirRota(1), POST = async () => 1;', 'POST não usa definirRota'],
    ['export async function\n  PUT() {}', 'PUT: declarado sem definirRota'],
    ['export let GET = definirRota(1);', 'GET: use const'],
  ])('rota: %j → %s', (codigo, problema) => expect(problemasDeRota(codigo)).toContain(problema));
});

describe('guarda obrigatória: varredura de src/', () => {
  it('varre arquivos de verdade', () => expect(listar(join(raiz, 'src')).filter((a) => EXTENSOES.test(a)).length).toBeGreaterThan(0));

  it('toda Server Action usa definirAcao e todo Route Handler usa definirRota', () => {
    expect(varrer(join(raiz, 'src'))).toEqual([]);
  });

  it('não existe Pages Router (src/pages): ele não passaria pela guarda', () => {
    expect(() => statSync(join(raiz, 'src/pages'))).toThrow();
  });
});
