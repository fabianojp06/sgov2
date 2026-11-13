import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedAdm } from '@/modules/adm';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { seedOrc } from './seed';

// Seed do orc (contrato C6; plano do P6, Task 1; P11; P12; P14; P17): 7 funcionalidades no menu Administração
// Central, as 3 dos casos de IA, fora do menu, e a proposta de TP no menu Cadastros.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let cliente: ReturnType<typeof criarPrisma>;

const permissoes = (perfil: string) =>
  cliente.$queryRaw<{ f: string }[]>`
    SELECT pp.funcionalidade_codigo || ':' || pp.acao AS f FROM perfil_permissao pp JOIN perfil p ON p.id = pp.perfil_id
    WHERE p.codigo = ${perfil} AND pp.funcionalidade_codigo LIKE 'orc.%' ORDER BY 1`.then((l) => l.map((x) => x.f));

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  cliente = criarPrisma(banco.urlMigrator);
  await executarSeeds(cliente, [seedAdm, seedOrc]);
});

afterAll(async () => {
  try {
    await cliente?.$disconnect();
  } finally {
    await banco?.parar();
  }
});

describe('seedOrc', () => {
  it('10 funcionalidades no módulo ADM_CENTRAL, com ajuda; as 3 da IA fora do menu, só com executar', async () => {
    const fs = await cliente.funcionalidade.findMany({ where: { codigo: { startsWith: 'orc.' }, moduloCodigo: 'ADM_CENTRAL' }, orderBy: { ordem: 'asc' } });
    expect(fs.map((f) => f.codigo)).toEqual([
      'orc.orcamento', 'orc.exercicios', 'orc.importacao', 'orc.receitas', 'orc.posicoes', 'orc.pacotes', 'orc.aprovacao',
      'orc.ia_justificativa', 'orc.ia_sugestao_conta', 'orc.ia_revisor',
    ]);
    expect(fs.filter((f) => !f.exibirNoMenu).map((f) => [f.codigo, f.rota, f.acoes])).toEqual([
      ['orc.ia_justificativa', '/orc/pacotes', ['executar']],
      ['orc.ia_sugestao_conta', '/orc/pacotes', ['executar']],
      ['orc.ia_revisor', '/orc/aprovacao', ['executar']],
    ]);
    expect(fs.every((f) => f.moduloCodigo === 'ADM_CENTRAL' && f.grupo === 'Orçamento da Adm. Central')).toBe(true);
    expect(fs.every((f) => (f.ajuda ?? '').trim().length > 0)).toBe(true);
  });

  it('proposta de TP no menu Cadastros › Propostas (US-065, D-P17-9)', async () => {
    const f = await cliente.funcionalidade.findUniqueOrThrow({ where: { codigo: 'orc.propostas' } });
    expect(f).toMatchObject({ moduloCodigo: 'CADASTROS', grupo: 'Propostas', nome: 'Propostas', rota: '/orc/propostas', exibirNoMenu: true, acoes: ['consultar', 'incluir', 'excluir'] });
    expect(await cliente.funcionalidade.count({ where: { codigo: { startsWith: 'orc.' } } })).toBe(12);
  });

  it('metas da proposta no menu Cadastros › Metas, no grupo Propostas (US-067, D-P19-8)', async () => {
    const f = await cliente.funcionalidade.findUniqueOrThrow({ where: { codigo: 'orc.metas' } });
    expect(f).toMatchObject({ moduloCodigo: 'CADASTROS', grupo: 'Propostas', nome: 'Metas', rota: '/orc/metas', exibirNoMenu: true, acoes: ['consultar', 'incluir', 'alterar', 'excluir'] });
  });

  it('perfis padrão da tabela da Task 1 (D-P6-4, D-P6-6)', async () => {
    expect(await permissoes('GFIN')).toEqual([
      'orc.aprovacao:consultar', 'orc.aprovacao:executar',
      'orc.exercicios:alterar', 'orc.exercicios:consultar', 'orc.exercicios:incluir',
      'orc.ia_justificativa:executar', 'orc.ia_revisor:executar', 'orc.ia_sugestao_conta:executar',
      'orc.importacao:consultar', 'orc.importacao:executar',
      'orc.metas:consultar',
      'orc.orcamento:alterar', 'orc.orcamento:consultar',
      'orc.pacotes:alterar', 'orc.pacotes:consultar', 'orc.pacotes:excluir', 'orc.pacotes:incluir',
      'orc.posicoes:alterar', 'orc.posicoes:consultar', 'orc.posicoes:excluir', 'orc.posicoes:incluir',
      'orc.propostas:consultar',
      'orc.receitas:alterar', 'orc.receitas:consultar', 'orc.receitas:excluir', 'orc.receitas:incluir',
    ]);
    expect(await permissoes('DIREX')).toEqual([
      'orc.aprovacao:aprovar', 'orc.aprovacao:consultar', 'orc.exercicios:consultar', 'orc.metas:consultar', 'orc.orcamento:consultar', 'orc.pacotes:consultar', 'orc.posicoes:consultar',
      'orc.propostas:consultar', 'orc.receitas:consultar',
    ]);
    expect(await permissoes('AUDITOR')).toEqual([
      'orc.aprovacao:consultar', 'orc.exercicios:consultar', 'orc.metas:consultar', 'orc.orcamento:consultar', 'orc.pacotes:consultar', 'orc.posicoes:consultar',
      'orc.propostas:consultar', 'orc.receitas:consultar',
    ]);
    expect(await permissoes('GESTOR_DIRETORIA')).toEqual([
      'orc.ia_justificativa:executar', 'orc.ia_sugestao_conta:executar',
      'orc.orcamento:consultar', 'orc.pacotes:alterar', 'orc.pacotes:consultar', 'orc.pacotes:excluir', 'orc.pacotes:incluir',
      'orc.posicoes:alterar', 'orc.posicoes:consultar', 'orc.posicoes:excluir', 'orc.posicoes:incluir',
    ]);
    // #403: o Administrador pede a avaliação da sugestão de conta na /int/ia; sem orc.pacotes, não lança pacote.
    expect(await permissoes('ADMINISTRADOR')).toEqual(['orc.ia_sugestao_conta:executar']);
    expect(await permissoes('ORCAMENTISTA')).toEqual([
      'orc.metas:alterar', 'orc.metas:consultar', 'orc.metas:excluir', 'orc.metas:incluir',
      'orc.propostas:consultar', 'orc.propostas:excluir', 'orc.propostas:incluir',
    ]);
    for (const perfil of ['ANALISTA_GRH', 'OPERADOR_VIAGENS']) {
      expect(await permissoes(perfil)).toEqual([]);
    }
  });

  it('casos de IA: só a sugestão de conta é avaliável (fila ia.avaliar, #403)', async () => {
    const casos = await cliente.iaCasoUso.findMany({ where: { codigo: { startsWith: 'orc.' } }, select: { codigo: true, avaliavel: true }, orderBy: { codigo: 'asc' } });
    expect(casos).toEqual([
      { codigo: 'orc.ia_justificativa', avaliavel: false },
      { codigo: 'orc.ia_revisor', avaliavel: false },
      { codigo: 'orc.ia_sugestao_conta', avaliavel: true },
    ]);
  });

  it('segunda execução não muda nada', async () => {
    const antes = await cliente.$queryRawUnsafe(`SELECT count(*)::int AS n FROM historico_operacao`);
    await executarSeeds(cliente, [seedAdm, seedOrc]);
    expect(await cliente.$queryRawUnsafe(`SELECT count(*)::int AS n FROM historico_operacao`)).toEqual(antes);
  });
});
