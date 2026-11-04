import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { seedAdm } from '../infrastructure/seed';
import { consultarHistorico, MENSAGEM_PERIODO } from './historico';

// Consulta do Histórico de Operações (US-040, UC02.24): alcance por perfil (RN0099, RN0100), filtros,
// paginação no banco e o registro da própria consulta (nível Avançado, §5).
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;
let admin: ContextoRequisicao;
let auditor: ContextoRequisicao;
const deps = () => ({ cliente: app });
const DE = new Date('2026-10-01T03:00:00Z');
const ATE = new Date('2026-10-31T03:00:00Z');

async function usuarioComPerfil(login: string, perfil: string): Promise<ContextoRequisicao> {
  const p = await migrator.perfil.findUniqueOrThrow({ where: { codigo: perfil } });
  const u = await migrator.usuario.create({
    data: { nome: login, email: `${login}@example.org`, login, loginNormalizado: login, senhaHash: 'x', trocaSenhaObrigatoria: false, perfis: { create: { perfilId: p.id } } },
  });
  return { usuarioId: u.id, usuarioRotulo: login, sessaoUid: 's1', ip: null, permissoes: new Set(['adm.historico:consultar']) };
}

async function registro(funcionalidade: string, tipo: string, rotulo: string, quando: string, descricao = `${tipo} em ${funcionalidade}`) {
  await migrator.$executeRaw`INSERT INTO historico_operacao (ocorrido_em, usuario_rotulo, funcionalidade, tipo_operacao, descricao)
    VALUES (${new Date(quando)}, ${rotulo}, ${funcionalidade}, ${tipo}::"TipoOperacao", ${descricao})`;
}

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  await executarSeeds(migrator, [seedAdm]);
  // A seed do adm dá ao AUDITOR só adm.historico (consultar, exportar, imprimir).
  admin = await usuarioComPerfil('adm.hist', 'ADMINISTRADOR');
  auditor = await usuarioComPerfil('aud.hist', 'AUDITOR');
  await registro('adm.usuarios', 'INSERCAO', 'Ana', '2026-10-05T12:00:00Z');
  await registro('adm.historico', 'CONSULTA', 'Bruno', '2026-10-06T12:00:00Z');
  await registro('orc.exercicios', 'ALTERACAO', 'ana.maria', '2026-10-07T12:00:00Z');
  await registro('sistema.seed', 'SISTEMA', 'Sistema', '2026-10-08T12:00:00Z');
  for (let i = 0; i < 60; i++) await registro('adm.usuarios', 'ALTERACAO', 'Lote', `2026-10-20T12:${String(i).padStart(2, '0')}:00Z`, `lote ${i}`);
  await registro('adm.usuarios', 'INSERCAO', 'Fora', '2026-11-15T12:00:00Z');
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

describe('consultarHistorico', () => {
  it('Administrador vê todas as funcionalidades, inclusive os registros fora do catálogo; período inclusivo', async () => {
    const r = await consultarHistorico(admin, { de: DE, ate: ATE, pagina: 1 }, deps());
    expect(r.ok && r.valor.total).toBe(64);
    const funcs = r.ok ? new Set(r.valor.linhas.map((l) => l.funcionalidade)) : new Set();
    expect(r.ok && r.valor.linhas.length).toBe(50);
    expect(funcs.has('adm.usuarios')).toBe(true);
  });

  it('Auditor vê só as funcionalidades do perfil dele (RN0099) e nunca as fora do catálogo (RN0100)', async () => {
    const r = await consultarHistorico(auditor, { de: DE, ate: ATE, pagina: 1 }, deps());
    expect(r.ok && r.valor.linhas.map((l) => l.funcionalidade)).toEqual(['adm.historico']);
  });

  it('filtros: usuário (parte do rótulo, sem diferenciar maiúsculas), funcionalidade e tipo', async () => {
    const ana = await consultarHistorico(admin, { de: DE, ate: ATE, pagina: 1, usuario: 'ANA' }, deps());
    expect(ana.ok && ana.valor.linhas.map((l) => l.usuario).sort()).toEqual(['Ana', 'ana.maria']);
    const orc = await consultarHistorico(admin, { de: DE, ate: ATE, pagina: 1, funcionalidade: 'orc.exercicios' }, deps());
    expect(orc.ok && orc.valor.total).toBe(1);
    const insercao = await consultarHistorico(admin, { de: DE, ate: ATE, pagina: 1, tipo: 'INSERCAO' }, deps());
    expect(insercao.ok && insercao.valor.linhas.map((l) => l.usuario)).toEqual(['Ana']);
  });

  it('página 2 traz os registros 51 em diante, do mais recente para o mais antigo; só os campos do UC02.24', async () => {
    const p1 = await consultarHistorico(admin, { de: DE, ate: ATE, pagina: 1 }, deps());
    const p2 = await consultarHistorico(admin, { de: DE, ate: ATE, pagina: 2 }, deps());
    expect(p1.ok && p1.valor.linhas[0]!.descricao).toBe('lote 59');
    expect(p2.ok && p2.valor.linhas.length).toBe(14);
    expect(p2.ok && p2.valor.linhas.at(-1)!.usuario).toBe('Ana');
    expect(p2.ok && Object.keys(p2.valor.linhas[0]!).sort()).toEqual(['descricao', 'funcionalidade', 'id', 'ocorridoEm', 'tipo', 'usuario']);
  });

  it('período acima de 366 dias ou invertido → erro de campo', async () => {
    expect(await consultarHistorico(admin, { de: new Date('2025-01-01'), ate: new Date('2026-01-03'), pagina: 1 }, deps())).toEqual({ ok: false, erros: [{ campo: 'de', mensagem: MENSAGEM_PERIODO }] });
    expect(await consultarHistorico(admin, { de: ATE, ate: DE, pagina: 1 }, deps())).toEqual({ ok: false, erros: [{ campo: 'de', mensagem: MENSAGEM_PERIODO }] });
  });

  it('cada consulta grava um CONSULTA com os filtros (nível Avançado, §5); sem a permissão → ErroPermissao', async () => {
    await consultarHistorico(admin, { de: DE, ate: ATE, pagina: 3, tipo: 'LOGIN' }, deps());
    const ultimo = await migrator.historicoOperacao.findFirstOrThrow({ where: { funcionalidade: 'adm.historico', usuarioId: admin.usuarioId }, orderBy: { id: 'desc' } });
    expect(ultimo).toMatchObject({ tipoOperacao: 'CONSULTA' });
    expect(ultimo.descricao).toContain('tipo LOGIN');
    expect(ultimo.descricao).toContain('página 3');
    await expect(consultarHistorico({ ...admin, permissoes: new Set() }, { de: DE, ate: ATE, pagina: 1 }, deps())).rejects.toBeInstanceOf(ErroPermissao);
  });
});
