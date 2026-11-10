import { describe, expect, it } from 'vitest';
import type { ContagemUsuarios } from '@/modules/adm/servidor';
import type { ResumoCadastros } from '@/modules/cad';
import { linhasConferencia } from './linhas-conferencia';

// Seção "Usuários" da conferência da carga, pela função pura (o contrato do adm vem montado à mão).
const resumo: ResumoCadastros = {
  contas: [],
  centrosCusto: [],
  centrosCustoProvisorios: 0,
  cargos: { ativos: 0, inativos: 0, comSalarioReal: 0, somaSalarioReal: { situacao: 'oculta' } },
  faixasSalariaisAtivas: 0,
  exercicio: null,
};
const usuarios: ContagemUsuarios = {
  perfis: [
    { codigo: 'GFIN', nome: 'Gestor Financeiro (GFIN)', ativo: true, ativos: 3, bloqueados: 1 },
    { codigo: 'AUDITOR', nome: 'Auditor', ativo: false, ativos: 2, bloqueados: 0 },
  ],
  trocaSenhaPendente: 4,
};

describe('linhasConferencia: seção Usuários', () => {
  it('ativos por perfil, bloqueados só quando houver, a marca do perfil inativo e a troca pendente', () => {
    const linhas = linhasConferencia(resumo, usuarios).filter((l) => l.secao === 'Usuários');
    expect(linhas.map((l) => [l.item, l.quantidade])).toEqual([
      ['Gestor Financeiro (GFIN): ativos (inclusive os bloqueados)', '3'],
      ['Gestor Financeiro (GFIN): bloqueados', '1'],
      ['Auditor (perfil inativo): ativos (inclusive os bloqueados)', '2'],
      ['Aguardando a troca da senha temporária', '4'],
    ]);
  });
});
