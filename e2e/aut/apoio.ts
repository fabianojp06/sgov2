import { expect, type Page } from '@playwright/test';

// Dados e passos comuns do E2E de acesso (P5, Task 7). O global-setup semeia estes usuários num
// banco efêmero; nenhum valor daqui existe fora do teste.
export const BASE = 'http://127.0.0.1:3190';

export const ADMIN_INICIAL = { login: 'admin.e2e', email: 'admin.e2e@exemplo.org', senha: 'SenhaInicialE2E2026' };
export const SENHA = 'SenhaE2E2026x';
export const NOVA_SENHA = 'NovaSenhaE2E2027y';

// Um usuário por cenário: bloqueio e logoff mudam o estado dele, e os specs rodam em sequência.
export const USUARIOS = {
  admin: { login: 'adm.menu', nome: 'E2E Administrador Menu', perfil: 'ADMINISTRADOR' },
  sair: { login: 'adm.sair', nome: 'E2E Administrador Sair', perfil: 'ADMINISTRADOR' },
  orcamentista: { login: 'orc.menu', nome: 'E2E Orçamentista Menu', perfil: 'ORCAMENTISTA' },
  bloqueio: { login: 'orc.bloqueio', nome: 'E2E Orçamentista Bloqueio', perfil: 'ORCAMENTISTA' },
  manutencao: { login: 'orc.manut', nome: 'E2E Orçamentista Manutenção', perfil: 'ORCAMENTISTA' },
} as const;

export async function entrar(page: Page, login: string, senha: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Login').fill(login);
  await page.getByLabel('Senha', { exact: true }).fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

export async function entrarNaTelaPrincipal(page: Page, login: string): Promise<void> {
  await entrar(page, login, SENHA);
  await expect(page).toHaveURL(/\/inicio$/);
}
