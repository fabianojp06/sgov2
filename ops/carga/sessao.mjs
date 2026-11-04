// Abre uma sessão pelo login real (Playwright) e imprime só o valor do cookie de sessão, para o
// ops/carga/paginas.js (plano do P7, Task 3). Também mede o login de ponta a ponta (uma vez).
// Uso: SGO_BASE=http://127.0.0.1:3200 SGO_LOGIN=... SGO_SENHA=... node ops/carga/sessao.mjs
// A senha vem do ambiente informado pelo PO na hora, nunca de arquivo (Global Constraints do P7).
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { chromium } from '@playwright/test';

const { SGO_BASE: base, SGO_LOGIN: login, SGO_SENHA: senha } = process.env;
if (!base || !login || !senha) {
  console.error('SGO_BASE, SGO_LOGIN e SGO_SENHA são obrigatórias');
  process.exit(2);
}

const navegador = await chromium.launch();
try {
  const pagina = await navegador.newPage();
  await pagina.goto(`${base}/login`);
  await pagina.getByLabel('Login').fill(login);
  await pagina.getByLabel('Senha', { exact: true }).fill(senha);
  const inicio = performance.now();
  await pagina.getByRole('button', { name: 'Entrar' }).click();
  await pagina.waitForURL(/\/(inicio|troca-senha)$/, { timeout: 30_000 });
  if (pagina.url().endsWith('/troca-senha')) throw new Error('O usuário tem troca de senha obrigatória: troque a senha pela tela antes da carga.');
  console.error(`[CARGA_LOGIN] ${Math.round(performance.now() - inicio)} ms até a tela principal`);
  const cookie = (await pagina.context().cookies()).find((c) => c.name === 'sgo_sessao' || c.name === '__Host-sgo_sessao');
  if (!cookie) throw new Error('Sem cookie de sessão depois do login');
  // Só o valor, no stdout, para ir direto a uma variável (SGO_SESSAO=$(node ...)).
  process.stdout.write(`${cookie.name}=${cookie.value}\n`);
} finally {
  await navegador.close();
}
