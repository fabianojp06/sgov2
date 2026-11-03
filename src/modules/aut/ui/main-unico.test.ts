import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// A TelaPrincipal já é o <main> da área logada: o que é renderizado dentro dela não abre outro (dois
// landmarks main confundem o leitor de tela). Fica de fora a casca (tela-principal, erro-carregamento)
// e o que é renderizado fora dela (/login, /troca-senha). As páginas do cad (frente B) têm o mesmo
// padrão e ficam de fora deste teste até a frente B tratar.
const RAIZ = fileURLToPath(new URL('../../../../', import.meta.url));
const SISTEMA = 'src/app/(sistema)';
const RAIZES = [SISTEMA, 'src/modules/aut/ui', 'src/modules/adm/ui', 'src/modules/orc/ui'];
const FORA = new Set([`${SISTEMA}/cad`, `${SISTEMA}/layout.tsx`]);
const FORA_DA_CASCA = new Set(['tela-principal.tsx', 'erro-carregamento.tsx', 'form-login.tsx', 'form-troca-senha.tsx']);

function arquivos(dir: string): string[] {
  return readdirSync(join(RAIZ, dir)).flatMap((nome) => {
    const caminho = `${dir}/${nome}`;
    if (FORA.has(caminho)) return [];
    if (statSync(join(RAIZ, caminho)).isDirectory()) return arquivos(caminho);
    return /\.tsx$/.test(nome) && !nome.includes('.test.') && !FORA_DA_CASCA.has(nome) ? [caminho] : [];
  });
}

describe('um <main> só na área logada', () => {
  it('cada raiz existe e tem arquivos (renomear não deixa o teste verde por engano)', () => {
    for (const r of RAIZES) {
      expect(existsSync(join(RAIZ, r)), r).toBe(true);
      expect(arquivos(r).length, r).toBeGreaterThan(0);
    }
  });

  it('o que é renderizado dentro da TelaPrincipal não abre outro <main> nem role="main"', () => {
    const lista = RAIZES.flatMap(arquivos);
    expect(lista).toContain(`${SISTEMA}/inicio/page.tsx`);
    expect(lista).toContain(`${SISTEMA}/error.tsx`);
    const comMain = lista.filter((f) => /<main[\s>]|role=["']main["']/.test(readFileSync(join(RAIZ, f), 'utf8')));
    expect(comMain.map((f) => relative('.', f))).toEqual([]);
  });
});
