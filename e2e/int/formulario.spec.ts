import { expect, test } from '@playwright/test';
import { entrarNaTelaPrincipal, USUARIOS } from '../aut/apoio';

// US-022: o Formulario do ger (C3) não perde o que foi digitado quando a ação falha. Com a rede caída,
// o envio vira a mensagem geral no resumo de erros, a tela fica (sem o error.tsx) e o campo mantém o
// valor. Usa a configuração geral da IA (Administrador) sem gravar nada.

test('falha de rede ao salvar: mensagem no formulário e o que foi digitado continua lá', async ({ page, context }) => {
  await entrarNaTelaPrincipal(page, USUARIOS.admin.login);
  await page.goto('/int/ia');
  const limite = page.getByLabel('Pedidos por minuto de cada pessoa');
  await limite.fill('7');
  await context.setOffline(true);
  try {
    await page.getByRole('button', { name: 'Salvar configuração' }).click();
    // O Next também mantém um anunciador de rota com role="alert": filtra pelo texto.
    await expect(page.getByRole('alert').filter({ hasText: 'Não foi possível concluir a operação. Tente novamente.' })).toBeVisible();
    await expect(limite).toHaveValue('7');
    await expect(page.getByRole('heading', { name: 'Configuração geral' })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
