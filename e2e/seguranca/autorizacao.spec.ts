import { expect, test } from '@playwright/test';
import pg from 'pg';
import { entrarNaTelaPrincipal, urlMigratorDoTeste, USUARIOS } from '../aut/apoio';

// Matriz de autorização das telas (plano do P7, Task 4, Step 1; US-116, #138; spec §11.3). As
// expectativas saem do catálogo gravado pelas seeds no banco do teste (contrato C6), não de uma
// lista à mão: para cada perfil e cada tela do menu, quem tem "consultar" abre a tela, e quem não
// tem recebe 404 (a tela não se revela). Um perfil novo ou uma permissão nova entram sozinhos.
type Tela = { rota: string; perfis: string[] };

async function lerCatalogo(): Promise<Tela[]> {
  const cliente = new pg.Client({ connectionString: urlMigratorDoTeste() });
  await cliente.connect();
  try {
    const { rows } = await cliente.query<Tela>(
      `SELECT f.rota,
              coalesce(array_agg(p.codigo ORDER BY p.codigo) FILTER (WHERE p.codigo IS NOT NULL), '{}') AS perfis
         FROM funcionalidade f
         LEFT JOIN perfil_permissao pp ON pp.funcionalidade_codigo = f.codigo AND pp.acao = 'consultar'
         LEFT JOIN perfil p ON p.id = pp.perfil_id
        WHERE f.ativo AND f.exibir_no_menu
        GROUP BY f.rota ORDER BY f.rota`,
    );
    return rows;
  } finally {
    await cliente.end();
  }
}

// Um usuário por perfil, todos já semeados pelo global-setup (e2e/aut/apoio.ts).
const PERFIS = [
  USUARIOS.admin,
  USUARIOS.orcamentista,
  USUARIOS.gfin,
  USUARIOS.direx,
  USUARIOS.gestor,
  USUARIOS.semPermissao,
] as const;

for (const u of PERFIS) {
  test(`${u.perfil}: abre só as telas em que tem "consultar"; as outras dão 404`, async ({ page }) => {
    const telas = await lerCatalogo();
    // Sem tela nenhuma, o teste passaria por engano (catálogo vazio ou consulta errada).
    expect(telas.length).toBeGreaterThan(5);
    await entrarNaTelaPrincipal(page, u.login);
    const erradas: string[] = [];
    for (const t of telas) {
      const pode = t.perfis.includes(u.perfil);
      const r = await page.request.get(t.rota, { maxRedirects: 0 });
      // Com permissão: a tela responde (200, ou um redirecionamento interno que não seja o login).
      const abriu = r.status() < 400 && !/\/login/.test(r.headers()['location'] ?? '');
      if (pode ? !abriu : r.status() !== 404) erradas.push(`${t.rota}: ${r.status()} (${pode ? 'devia abrir' : 'devia dar 404'})`);
    }
    expect(erradas).toEqual([]);
  });
}
