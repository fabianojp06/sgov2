import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// A IA só pela governança (US-019). Fora de src/shared/ia:
// - ninguém cria o provedor, importa os arquivos internos (com alias ou relativo) nem o SDK;
// - o provedor falso só nos testes (uma resposta falsa nunca chega a um usuário real);
// - o SISTEMA_IA (sem permissão nem limite por minuto) e o isentoLimitePorMinuto (avaliação) só no worker
//   e nos trabalhadores de fila.
const RAIZ = process.cwd();
const PASTAS = ['src', 'worker', 'prisma', 'scripts', 'e2e', 'tests'];
const INTERNO = /criarProvedorIA\b|criarProvedorAnthropic|shared\/ia\/(?!index\b)[\w-]+|@anthropic-ai\/sdk/;
const TESTE = /\.(test|test-util|int\.test)\.ts$|^tests\/|^e2e\//;
const TRABALHADOR = /^worker\/|^src\/modules\/[a-z]+\/infrastructure\//;

function arquivos(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const caminho = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'generated' || e.name === 'migrations' ? [] : arquivos(caminho);
    return /\.(ts|tsx|mjs)$/.test(e.name) ? [caminho] : [];
  });
}

const FORA = PASTAS.flatMap((p) => arquivos(join(RAIZ, p)))
  .map((a) => relative(RAIZ, a))
  .filter((a) => !a.startsWith('src/shared/ia/'))
  .map((a) => ({ a, texto: readFileSync(join(RAIZ, a), 'utf8') }));

describe('fronteira da IA', () => {
  it('nada cria o provedor nem importa os arquivos internos ou o SDK', () => {
    expect(FORA.filter((f) => INTERNO.test(f.texto)).map((f) => f.a)).toEqual([]);
  });

  it('o provedor falso só nos testes', () => {
    expect(FORA.filter((f) => !TESTE.test(f.a) && f.texto.includes('criarProvedorIAFalso')).map((f) => f.a)).toEqual([]);
  });

  it('SISTEMA_IA e isentoLimitePorMinuto só no worker e nos trabalhadores de fila (infrastructure dos módulos)', () => {
    const fora = (nome: string) => FORA.filter((f) => !TESTE.test(f.a) && !TRABALHADOR.test(f.a) && f.texto.includes(nome)).map((f) => f.a);
    expect(fora('SISTEMA_IA')).toEqual([]);
    expect(fora('isentoLimitePorMinuto')).toEqual([]);
  });
});
