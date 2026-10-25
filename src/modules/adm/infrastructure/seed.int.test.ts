import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarPrisma, executarSeeds, type Seed } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { instalarFuncionalidades } from '../application/instalar-funcionalidades';
import type { DeclaracaoFuncionalidade } from '../application/catalogo';
import { seedAdm } from './seed';

// Seed do adm (US-034, UC02.27): idempotente e sem sobrescrever o Administrador (RN_SEED_002).
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let cliente: ReturnType<typeof criarPrisma>;

const TABELAS = [
  'configuracao_acesso',
  'modulo',
  'funcionalidade',
  'perfil',
  'perfil_permissao',
  'permissao_padrao_aplicada',
  'historico_operacao',
];

// Retrato ordenado do conteúdo (não só da contagem): pega UPDATE indevido na segunda execução.
async function retrato(): Promise<Record<string, unknown[]>> {
  const r: Record<string, unknown[]> = {};
  for (const t of TABELAS) {
    r[t] = await cliente.$queryRawUnsafe(`SELECT to_jsonb(x) AS l FROM ${t} x ORDER BY to_jsonb(x)::text`);
  }
  return r;
}

const permissoes = (perfil: string, funcionalidade: string) =>
  cliente.$queryRaw<{ acao: string }[]>`
    SELECT pp.acao FROM perfil_permissao pp JOIN perfil p ON p.id = pp.perfil_id
    WHERE p.codigo = ${perfil} AND pp.funcionalidade_codigo = ${funcionalidade} ORDER BY pp.acao`.then((l) =>
    l.map((x) => x.acao),
  );

const seedCom = (itens: readonly DeclaracaoFuncionalidade[]): Seed => ({
  nome: 'teste',
  executar: async (tx) => {
    await instalarFuncionalidades(tx, itens);
  },
});

const cargos: DeclaracaoFuncionalidade = {
  codigo: 'cad.cargos',
  modulo: 'CADASTROS',
  grupo: 'Pessoal',
  nome: 'Cargos',
  rota: '/cad/cargos',
  ordem: 1,
  acoes: ['consultar', 'incluir'],
  perfisPadrao: { ANALISTA_GRH: ['consultar'] },
};

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  cliente = criarPrisma(banco.urlMigrator);
});

afterAll(async () => {
  try {
    await cliente?.$disconnect();
  } finally {
    await banco?.parar();
  }
});

describe('seedAdm', () => {
  it('primeira execução: configuração, 6 módulos, 8 perfis, adm.usuarios só do Administrador', async () => {
    await executarSeeds(cliente, [seedAdm]);
    const config = await cliente.configuracaoAcesso.findUniqueOrThrow({ where: { id: 1 } });
    expect(config).toMatchObject({ limiteTentativas: 5, limiarAlerta: 3, inatividadeMin: 30, sessaoMaximaHoras: 12 });
    expect(config).toMatchObject({ senhaTemporariaHoras: 24, senhaMinimo: 10, manutencao: false });
    expect(config).toMatchObject({ senhaExigeLetra: true, senhaExigeDigito: true });
    expect(await cliente.modulo.count()).toBe(6);
    const perfis = await cliente.perfil.findMany({ orderBy: { codigo: 'asc' } });
    expect(perfis.map((p) => p.codigo)).toEqual([
      'ADMINISTRADOR',
      'ANALISTA_GRH',
      'AUDITOR',
      'DIREX',
      'GESTOR_DIRETORIA',
      'GFIN',
      'OPERADOR_VIAGENS',
      'ORCAMENTISTA',
    ]);
    expect(perfis.every((p) => p.ativo)).toBe(true);
    expect(await permissoes('ADMINISTRADOR', 'adm.usuarios')).toEqual(['alterar', 'consultar', 'incluir']);
    const outros = await cliente.perfilPermissao.count({
      where: { funcionalidadeCodigo: 'adm.usuarios', perfil: { codigo: { not: 'ADMINISTRADOR' } } },
    });
    expect(outros).toBe(0);
    const historico = await cliente.historicoOperacao.findMany({ where: { funcionalidade: 'adm.seed' } });
    expect(historico.length).toBeGreaterThan(0);
    expect(historico.every((h) => h.tipoOperacao === 'SISTEMA' && h.origem === 'SISTEMA' && h.usuarioId === null)).toBe(true);
  });

  it('roda duas vezes sem mudar nada', async () => {
    const antes = await retrato();
    await executarSeeds(cliente, [seedAdm]);
    expect(await retrato()).toEqual(antes);
  });

  it('não sobrescreve ajuste do administrador', async () => {
    await cliente.funcionalidade.update({ where: { codigo: 'adm.usuarios' }, data: { ativo: false } });
    await cliente.$executeRaw`
      DELETE FROM perfil_permissao WHERE acao = 'incluir' AND funcionalidade_codigo = 'adm.usuarios'`;
    await cliente.modulo.update({ where: { codigo: 'RELATORIOS' }, data: { ativo: false } });
    const ajustado = await retrato();
    await executarSeeds(cliente, [seedAdm]);
    expect(await retrato()).toEqual(ajustado);
    expect((await cliente.funcionalidade.findUniqueOrThrow({ where: { codigo: 'adm.usuarios' } })).ativo).toBe(false);
    expect(await permissoes('ADMINISTRADOR', 'adm.usuarios')).toEqual(['alterar', 'consultar']);
    expect((await cliente.modulo.findUniqueOrThrow({ where: { codigo: 'RELATORIOS' } })).ativo).toBe(false);
  });

  it('funcionalidade nova recebe as permissões padrão; atualizar a declaração não reativa', async () => {
    await executarSeeds(cliente, [seedCom([cargos])]);
    expect(await permissoes('ANALISTA_GRH', 'cad.cargos')).toEqual(['consultar']);
    await cliente.funcionalidade.update({ where: { codigo: 'cad.cargos' }, data: { ativo: false } });
    await executarSeeds(cliente, [seedCom([{ ...cargos, nome: 'Cargos e salários' }])]);
    const f = await cliente.funcionalidade.findUniqueOrThrow({ where: { codigo: 'cad.cargos' } });
    expect(f).toMatchObject({ nome: 'Cargos e salários', ativo: false });
  });

  it('ação padrão nova vai para quem ainda tem acesso; a removida não volta (R12)', async () => {
    const v2 = { ...cargos, perfisPadrao: { ANALISTA_GRH: ['consultar', 'incluir'], AUDITOR: ['consultar'] } } as const;
    await executarSeeds(cliente, [seedCom([v2])]);
    expect(await permissoes('ANALISTA_GRH', 'cad.cargos')).toEqual(['consultar', 'incluir']);
    expect(await permissoes('AUDITOR', 'cad.cargos')).toEqual(['consultar']);
    // O Administrador tira tudo do AUDITOR: um padrão novo para ele não devolve o item ao menu.
    await cliente.$executeRaw`
      DELETE FROM perfil_permissao WHERE funcionalidade_codigo = 'cad.cargos'
      AND perfil_id = (SELECT id FROM perfil WHERE codigo = 'AUDITOR')`;
    const v3 = { ...v2, acoes: ['consultar', 'incluir', 'exportar'], perfisPadrao: { ...v2.perfisPadrao, AUDITOR: ['consultar', 'exportar'] } } as const;
    await executarSeeds(cliente, [seedCom([v3])]);
    expect(await permissoes('AUDITOR', 'cad.cargos')).toEqual([]);
  });

  it('perfil criado depois da funcionalidade recebe o padrão na seed seguinte', async () => {
    const ferias = { ...cargos, codigo: 'cad.ferias', perfisPadrao: { DIREX: ['consultar'] } } as const;
    const direx = await cliente.perfil.findUniqueOrThrow({ where: { codigo: 'DIREX' } });
    await cliente.$executeRaw`DELETE FROM perfil WHERE id = ${direx.id}::uuid`;
    await executarSeeds(cliente, [seedCom([ferias])]);
    expect(await cliente.perfilPermissao.count({ where: { funcionalidadeCodigo: 'cad.ferias' } })).toBe(0);
    await executarSeeds(cliente, [seedAdm, seedCom([ferias])]);
    expect(await permissoes('DIREX', 'cad.ferias')).toEqual(['consultar']);
  });

  it('permissão já existente não gera Histórico de concessão', async () => {
    const relatorio = { ...cargos, codigo: 'cad.relatorio', perfisPadrao: {} };
    await executarSeeds(cliente, [seedCom([relatorio])]);
    const gfin = await cliente.perfil.findUniqueOrThrow({ where: { codigo: 'GFIN' } });
    await cliente.perfilPermissao.create({ data: { perfilId: gfin.id, funcionalidadeCodigo: 'cad.relatorio', acao: 'consultar' } });
    await executarSeeds(cliente, [seedCom([{ ...relatorio, perfisPadrao: { GFIN: ['consultar'] } }])]);
    expect(await cliente.historicoOperacao.count({ where: { descricao: { contains: 'cad.relatorio:consultar' } } })).toBe(0);
  });

  it('funcionalidade que passa para ADMINISTRACAO com permissão de outro perfil falha', async () => {
    await expect(
      executarSeeds(cliente, [seedCom([{ ...cargos, modulo: 'ADMINISTRACAO', perfisPadrao: {} }])]),
    ).rejects.toThrow('Falha na seed "teste"');
  });

  it('declaração inválida desfaz a seed inteira', async () => {
    const proibida = { ...cargos, codigo: 'adm.x', modulo: 'ADMINISTRACAO' as const, perfisPadrao: { AUDITOR: ['consultar'] as const } };
    await expect(executarSeeds(cliente, [seedCom([proibida])])).rejects.toThrow('Falha na seed "teste"');
    expect(await cliente.funcionalidade.count({ where: { codigo: 'adm.x' } })).toBe(0);
  });
});
