import { expect, test } from '@playwright/test';
import { entrarNaTelaPrincipal, USUARIOS } from './apoio';

// Sessão única com aviso (US-028, RN0519, EP084 UC01.02 A2): o login na estação B encerra a sessão
// da estação A, que vê o aviso na próxima interação.
const AVISO = 'Sua sessão foi encerrada porque um novo acesso foi realizado com suas credenciais.';

test('login em outra estação: a anterior cai no login com o aviso da RN0519', async ({ browser }) => {
  const estacaoA = await browser.newContext();
  const estacaoB = await browser.newContext();
  try {
    const a = await estacaoA.newPage();
    await entrarNaTelaPrincipal(a, USUARIOS.sessaoUnica.login);
    const b = await estacaoB.newPage();
    await entrarNaTelaPrincipal(b, USUARIOS.sessaoUnica.login);

    await a.goto('/inicio');
    await expect(a).toHaveURL(/\/login\?motivo=novo-acesso$/);
    await expect(a.getByRole('alert').filter({ hasText: AVISO })).toBeVisible();
    // A estação B continua com a sessão.
    await b.goto('/inicio');
    await expect(b).toHaveURL(/\/inicio$/);
    await expect(b.getByText(USUARIOS.sessaoUnica.nome)).toBeVisible();
  } finally {
    await Promise.all([estacaoA.close(), estacaoB.close()]);
  }
});
