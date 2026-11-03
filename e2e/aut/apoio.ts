import { expect, type Page } from '@playwright/test';

// Dados e passos comuns do E2E de acesso (P5, Task 7). O global-setup semeia estes usuários num
// banco efêmero; nenhum valor daqui existe fora do teste.
export const BASE = 'http://127.0.0.1:3190';

export const ADMIN_INICIAL = { login: 'admin.e2e', email: 'admin.e2e@example.org', senha: 'SenhaInicialE2E2026' };
export const SENHA = 'SenhaE2E2026x';
export const NOVA_SENHA = 'NovaSenhaE2E2027y';

export const PERFIL_SEM_PERMISSAO = 'E2E_SEM_PERMISSAO';

// Um usuário por cenário: bloqueio, senha errada e logoff mudam o estado dele. Só a manutenção é
// global, e o spec a desliga no finally; com mais de um worker, isso deixaria de bastar.
export const USUARIOS = {
  admin: { login: 'adm.menu', nome: 'E2E Administrador Menu', perfil: 'ADMINISTRADOR' },
  sair: { login: 'adm.sair', nome: 'E2E Administrador Sair', perfil: 'ADMINISTRADOR' },
  senhaErrada: { login: 'orc.senha', nome: 'E2E Orçamentista Senha', perfil: 'ORCAMENTISTA' },
  orcamentista: { login: 'orc.menu', nome: 'E2E Orçamentista Menu', perfil: 'ORCAMENTISTA' },
  bloqueio: { login: 'orc.bloqueio', nome: 'E2E Orçamentista Bloqueio', perfil: 'ORCAMENTISTA' },
  manutencao: { login: 'orc.manut', nome: 'E2E Orçamentista Manutenção', perfil: 'ORCAMENTISTA' },
  // Cadastro de usuários (e2e/adm/usuarios.spec.ts, US-038).
  cadastro: { login: 'adm.usuarios', nome: 'E2E Administrador Usuários', perfil: 'ADMINISTRADOR' },
  desbloqueio: { login: 'orc.desbloq', nome: 'E2E Orçamentista Desbloqueio', perfil: 'ORCAMENTISTA' },
  // Perfil criado só no banco do teste, sem permissão nenhuma (RN0521): com as seeds do cad e do
  // orc, todos os perfis padrão, menos o Administrador, recebem alguma funcionalidade.
  semPermissao: { login: 'sem.permissao', nome: 'E2E Sem Permissão', perfil: PERFIL_SEM_PERMISSAO },
  // Orçamento da Adm. Central (e2e/orc/orcamento.spec.ts, P6). O gestor vê só a subárvore da
  // Diretoria de Estudos e Projetos (4.1) da minuta de CC carregada pela seed do cad.
  gfin: { login: 'gfin.orc', nome: 'E2E Gestor Financeiro', perfil: 'GFIN' },
  direx: { login: 'direx.orc', nome: 'E2E Diretoria Executiva', perfil: 'DIREX' },
  gestor: { login: 'gestor.dep', nome: 'E2E Gestor da DEP', perfil: 'GESTOR_DIRETORIA', ccEscopo: '4.1' },
  // GFIN da frente B para a rolagem do plano de contas (e2e/cad/rolagem-plano.spec.ts, issue #218).
  gfinPlano: { login: 'gfin.plano', nome: 'E2E Gestor Financeiro Plano', perfil: 'GFIN' },
} as const satisfies Record<string, { login: string; nome: string; perfil: string; ccEscopo?: string }>;

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
