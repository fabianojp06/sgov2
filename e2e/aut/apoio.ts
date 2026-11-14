import { expect, type Page } from '@playwright/test';

// Dados e passos comuns do E2E de acesso (P5, Task 7). O global-setup semeia estes usuários num
// banco efêmero; nenhum valor daqui existe fora do teste.
export const BASE = 'http://127.0.0.1:3190';

export const ADMIN_INICIAL = { login: 'admin.e2e', email: 'admin.e2e@example.org', senha: 'SenhaInicialE2E2026' };
export const SENHA = 'SenhaE2E2026x';
export const NOVA_SENHA = 'NovaSenhaE2E2027y';

export const PERFIL_SEM_PERMISSAO = 'E2E_SEM_PERMISSAO';

// Um usuário por cenário: bloqueio, senha errada e logoff mudam o estado dele. Só a manutenção (o
// estado do sistema) é global, e os specs que a ligam a desligam no finally; com mais de um worker,
// isso deixaria de bastar.
export const USUARIOS = {
  admin: { login: 'adm.menu', nome: 'E2E Administrador Menu', perfil: 'ADMINISTRADOR' },
  sair: { login: 'adm.sair', nome: 'E2E Administrador Sair', perfil: 'ADMINISTRADOR' },
  // Sessão única com aviso (e2e/aut/sessao-unica.spec.ts, US-028).
  sessaoUnica: { login: 'adm.sessao', nome: 'E2E Administrador Sessão', perfil: 'ADMINISTRADOR' },
  // Recuperar a senha pela tela de login (e2e/aut/recuperar-senha.spec.ts, US-029).
  recuperacao: { login: 'orc.recupera', nome: 'E2E Orçamentista Recuperação', perfil: 'ORCAMENTISTA' },
  senhaErrada: { login: 'orc.senha', nome: 'E2E Orçamentista Senha', perfil: 'ORCAMENTISTA' },
  orcamentista: { login: 'orc.menu', nome: 'E2E Orçamentista Menu', perfil: 'ORCAMENTISTA' },
  bloqueio: { login: 'orc.bloqueio', nome: 'E2E Orçamentista Bloqueio', perfil: 'ORCAMENTISTA' },
  manutencao: { login: 'orc.manut', nome: 'E2E Orçamentista Manutenção', perfil: 'ORCAMENTISTA' },
  // Cadastro de usuários (e2e/adm/usuarios.spec.ts, US-038).
  cadastro: { login: 'adm.usuarios', nome: 'E2E Administrador Usuários', perfil: 'ADMINISTRADOR' },
  desbloqueio: { login: 'orc.desbloq', nome: 'E2E Orçamentista Desbloqueio', perfil: 'ORCAMENTISTA' },
  // Exceções de permissão por usuário (e2e/adm/usuarios.spec.ts, US-039).
  excecoes: { login: 'adm.excecoes', nome: 'E2E Administrador Exceções', perfil: 'ADMINISTRADOR' },
  orcExcecoes: { login: 'orc.excecoes', nome: 'E2E Orçamentista Exceções', perfil: 'ORCAMENTISTA' },
  // Alçadas de aprovação (e2e/adm/alcadas.spec.ts, US-042).
  alcadas: { login: 'adm.alcadas', nome: 'E2E Administrador Alçadas', perfil: 'ADMINISTRADOR' },
  // Histórico de Operações (e2e/adm/historico.spec.ts, US-040).
  historico: { login: 'adm.historico', nome: 'E2E Administrador Histórico', perfil: 'ADMINISTRADOR' },
  auditor: { login: 'aud.historico', nome: 'E2E Auditor Histórico', perfil: 'AUDITOR' },
  // Módulos e funcionalidades (e2e/adm/modulos.spec.ts, US-035): o GFIN vê o menu da Adm. Central.
  modulos: { login: 'adm.modulos', nome: 'E2E Administrador Módulos', perfil: 'ADMINISTRADOR' },
  gfinModulos: { login: 'gfin.modulos', nome: 'E2E Gestor Financeiro Módulos', perfil: 'GFIN' },
  // Ativar e desativar o sistema (e2e/adm/sistema.spec.ts, US-036/US-033).
  sistema: { login: 'adm.sistema', nome: 'E2E Administrador Sistema', perfil: 'ADMINISTRADOR' },
  sistemaOrc: { login: 'orc.sistema', nome: 'E2E Orçamentista Sistema', perfil: 'ORCAMENTISTA' },
  // Notificações de desempenho (e2e/adm/notificacoes.spec.ts, US-041).
  notificacoes: { login: 'adm.notif', nome: 'E2E Administrador Notificações', perfil: 'ADMINISTRADOR' },
  // Perfis e permissões (e2e/adm/perfis.spec.ts, US-037): o orçamentista recebe o perfil criado
  // pela tela e volta ao Orçamentista no fim.
  perfis: { login: 'adm.perfis', nome: 'E2E Administrador Perfis', perfil: 'ADMINISTRADOR' },
  orcPerfis: { login: 'orc.perfis', nome: 'E2E Orçamentista Perfis', perfil: 'ORCAMENTISTA' },
  // CSP completa nas telas (e2e/aut/csp.spec.ts, #318).
  csp: { login: 'adm.csp', nome: 'E2E Administrador CSP', perfil: 'ADMINISTRADOR' },
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
  // Proposta de TP e abas (e2e/orc/propostas.spec.ts, P17 a P25): o spec entra uma vez por passo, e o limite de
  // login por usuário (20 em 5 minutos) estourava quando ele dividia o orc.menu com os outros specs.
  propostas: { login: 'orc.propostas', nome: 'E2E Orçamentista Propostas', perfil: 'ORCAMENTISTA' },
  // Aprovador da oficialização das propostas (e2e/orc/propostas.spec.ts, US-079): titular da alçada WA01 que o
  // spec cria e apaga; próprio, para não dividir o limite de login com o gfin.orc.
  gfinPropostas: { login: 'gfin.propostas', nome: 'E2E Gestor Financeiro Propostas', perfil: 'GFIN' },
  // Analista do GRH que finaliza o pessoal das propostas (e2e/orc/propostas.spec.ts, US-080, WA05).
  grhPropostas: { login: 'grh.propostas', nome: 'E2E Analista GRH Propostas', perfil: 'ANALISTA_GRH' },
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
