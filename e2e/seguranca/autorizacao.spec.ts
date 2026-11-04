import { expect, test } from '@playwright/test';
import pg from 'pg';
import { entrarNaTelaPrincipal, PERFIL_SEM_PERMISSAO, urlMigratorDoTeste, USUARIOS } from '../aut/apoio';

// Matriz de autorização das telas (plano do P7, Task 4, Step 1; US-116, #138; spec §11.3). As
// expectativas saem do catálogo gravado pelas seeds no banco do teste (contrato C6), não de uma
// lista à mão: para cada perfil e cada tela do menu, quem tem "consultar" abre a tela (200), e quem
// não tem recebe 404 (a tela não se revela). Um perfil novo ou uma permissão nova entram sozinhos.
// Os filtros são os do login (carregarPermissoes): funcionalidade, módulo e perfil ativos.
type Tela = { codigo: string; rota: string; perfis: string[] };

async function lerCatalogo(): Promise<Tela[]> {
  const cliente = new pg.Client({ connectionString: urlMigratorDoTeste() });
  await cliente.connect();
  try {
    const { rows } = await cliente.query<Tela>(
      `SELECT f.codigo, f.rota,
              coalesce(array_agg(p.codigo ORDER BY p.codigo) FILTER (WHERE p.codigo IS NOT NULL), '{}') AS perfis
         FROM funcionalidade f
         JOIN modulo m ON m.codigo = f.modulo_codigo AND m.ativo
         LEFT JOIN perfil_permissao pp ON pp.funcionalidade_codigo = f.codigo AND pp.acao = 'consultar'
         LEFT JOIN perfil p ON p.id = pp.perfil_id AND p.ativo
        WHERE f.ativo AND f.exibir_no_menu
        GROUP BY f.codigo, f.rota ORDER BY f.rota`,
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

test('o catálogo do teste tem as telas conhecidas, uma funcionalidade por rota', async () => {
  const telas = await lerCatalogo();
  const rotas = telas.map((t) => t.rota);
  // Sem isso, um catálogo vazio ou uma consulta errada deixaria a matriz verde por engano.
  expect(rotas).toEqual(expect.arrayContaining(['/adm/usuarios', '/cad/plano-contas', '/cad/cargos', '/orc/orcamento']));
  // A guarda da página exige uma funcionalidade só: duas no menu com a mesma rota somariam perfis.
  expect(new Set(rotas).size).toBe(rotas.length);
  // Todo perfil com usuário no teste, menos o sem permissão, abre ao menos uma tela.
  for (const u of PERFIS) {
    if (u.perfil !== PERFIL_SEM_PERMISSAO) expect(telas.some((t) => t.perfis.includes(u.perfil)), u.perfil).toBe(true);
  }
});

for (const u of PERFIS) {
  test(`${u.perfil}: abre só as telas em que tem "consultar"; as outras dão 404`, async ({ page }) => {
    const telas = await lerCatalogo();
    await entrarNaTelaPrincipal(page, u.login);
    const erradas: string[] = [];
    for (const t of telas) {
      const pode = t.perfis.includes(u.perfil);
      // Sem seguir redirecionamento: nenhuma tela do catálogo redireciona, e um 3xx para o login ou
      // para a troca de senha seria negação disfarçada.
      const r = await page.request.get(t.rota, { maxRedirects: 0 });
      const esperado = pode ? 200 : 404;
      if (r.status() !== esperado) erradas.push(`${t.rota} (${t.codigo}): ${r.status()}, esperado ${esperado}`);
    }
    expect(erradas).toEqual([]);
  });
}
