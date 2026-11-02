import { expect, type Page } from '@playwright/test';

// Dados e passos comuns do E2E de acesso (P5, Task 7). O global-setup semeia estes usuários num
// banco efêmero; nenhum valor daqui existe fora do teste.
export const BASE = 'http://127.0.0.1:3190';

export const ADMIN_INICIAL = { login: 'admin.e2e', email: 'admin.e2e@example.org', senha: 'SenhaInicialE2E2026' };
export const SENHA = 'SenhaE2E2026x';
export const NOVA_SENHA = 'NovaSenhaE2E2027y';

// Um usuário por cenário: bloqueio, senha errada e logoff mudam o estado dele. Só a manutenção é
// global, e o spec a desliga no finally; com mais de um worker, isso deixaria de bastar.
export const USUARIOS = {
  admin: { login: 'adm.menu', nome: 'E2E Administrador Menu', perfil: 'ADMINISTRADOR' },
  sair: { login: 'adm.sair', nome: 'E2E Administrador Sair', perfil: 'ADMINISTRADOR' },
  senhaErrada: { login: 'orc.senha', nome: 'E2E Orçamentista Senha', perfil: 'ORCAMENTISTA' },
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

// Banco do teste para os specs que mexem na configuração: só o efêmero do global-setup, nunca o de
// dev (55432/56432) nem outro host (regra 3 do CLAUDE.md).
export function urlMigratorDoTeste(): string {
  const url = process.env.E2E_MIGRATOR_URL;
  if (!url) throw new Error('E2E_MIGRATOR_URL ausente: rode pelo npm run test:e2e (global-setup)');
  const { hostname, port, pathname } = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(hostname) || ['55432', '56432'].includes(port) || pathname !== '/sgo_teste') {
    throw new Error('E2E_MIGRATOR_URL não é o banco efêmero do teste');
  }
  return url;
}

export async function entrarNaTelaPrincipal(page: Page, login: string): Promise<void> {
  await entrar(page, login, SENHA);
  await expect(page).toHaveURL(/\/inicio$/);
}
