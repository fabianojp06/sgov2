import { describe, expect, it } from 'vitest';
import { MENSAGENS } from './mensagens';

describe('mensagens do login (EP084)', () => {
  it('textos exatos', () =>
    expect(MENSAGENS).toMatchObject({
      OBRIGATORIOS: 'Login e/ou Senha são obrigatórios',
      CREDENCIAIS: 'Login ou senha inválidos',
      BLOQUEADO: 'Usuário bloqueado. Contate o Administrador do sistema.',
      MANUTENCAO: 'Sistema está em manutenção',
      ULTIMA_TENTATIVA: 'Atenção: resta 1 (uma) tentativa antes do bloqueio da conta.',
      FALHA_SESSAO: 'Não foi possível iniciar sua sessão. Tente novamente.',
    }));
});
