import { describe, expect, it } from 'vitest';
import { descrever } from './descricao';

describe('descrever (RN0089 a RN0094)', () => {
  it.each([
    ['INSERCAO', 'Inseriu o registro 42 referente à Usuários'],
    ['ALTERACAO', 'Alterou o registro 42 referente à Usuários'],
    ['EXCLUSAO', 'Excluiu o registro 42 referente à Usuários'],
    ['CONSULTA', 'Acessou a funcionalidade Usuários'],
    ['IMPRESSAO', 'Imprimiu a listagem referente à Usuários'],
    ['EXPORTACAO', 'Exportou a listagem referente à Usuários'],
    ['LOGIN', 'Entrou no sistema'],
    ['LOGOFF', 'Saiu do sistema'],
    ['SISTEMA', 'Ação automática do sistema referente à Usuários'],
  ] as const)('%s → %s', (tipo, esperado) => expect(descrever(tipo, 'Usuários', '42')).toBe(esperado));

  it('sem registro, as operações de registro não citam id', () => {
    expect(descrever('INSERCAO', 'Usuários')).toBe('Inseriu um registro referente à Usuários');
  });
});
