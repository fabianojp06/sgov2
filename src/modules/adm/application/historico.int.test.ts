import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { seedAdm } from '../infrastructure/seed';
import ExcelJS from 'exceljs';
import { consultarHistorico, exportarHistorico, MENSAGEM_EXPORTACAO_LIMITE, MENSAGEM_PERIODO, MENSAGEM_USUARIO_FILTRO, registrarImpressao } from './historico';

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
  await registro('adm.usuarios', 'INSERCAO', 'cem%_por', '2026-09-15T12:00:00Z');
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

  it('% e _ no filtro de usuário são literais; página NaN vira a 1; filtro de usuário acima de 120 caracteres → erro', async () => {
    const setembro = { de: new Date('2026-09-01T03:00:00Z'), ate: new Date('2026-09-30T03:00:00Z') };
    const pct = await consultarHistorico(admin, { ...setembro, pagina: 1, usuario: '%_' }, deps());
    expect(pct.ok && pct.valor.linhas.map((l) => l.usuario)).toEqual(['cem%_por']);
    const sublinhado = await consultarHistorico(admin, { ...setembro, pagina: 1, usuario: 'm_p' }, deps());
    expect(sublinhado.ok && sublinhado.valor.total).toBe(0);
    const nan = await consultarHistorico(admin, { de: DE, ate: ATE, pagina: Number.NaN }, deps());
    expect(nan.ok && nan.valor.pagina).toBe(1);
    expect(await consultarHistorico(admin, { de: DE, ate: ATE, pagina: 1, usuario: 'x'.repeat(121) }, deps())).toEqual({ ok: false, erros: [{ campo: 'usuario', mensagem: MENSAGEM_USUARIO_FILTRO }] });
  });

  it('perfil ADMINISTRADOR inativo não dá o alcance total', async () => {
    const outro = await usuarioComPerfil('adm.inativo', 'ADMINISTRADOR');
    await migrator.perfil.update({ where: { codigo: 'ADMINISTRADOR' }, data: { ativo: false } });
    try {
      const r = await consultarHistorico(outro, { de: DE, ate: ATE, pagina: 1 }, deps());
      expect(r.ok && r.valor.total).toBe(0);
    } finally {
      await migrator.perfil.update({ where: { codigo: 'ADMINISTRADOR' }, data: { ativo: true } });
    }
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

describe('exportarHistorico e registrarImpressao (UC0.05, RN_LOG_EXP)', () => {
  const exportador = () => ({ ...admin, permissoes: new Set(['adm.historico:consultar', 'adm.historico:exportar', 'adm.historico:imprimir']) });

  it('XLSX com os filtros na primeira linha e as colunas do UC02.24; EXPORTACAO com a quantidade e os filtros', async () => {
    const r = await exportarHistorico(exportador(), { de: DE, ate: ATE, funcionalidade: 'orc.exercicios' }, deps());
    expect(r.ok).toBe(true);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((r.ok ? r.valor.bytes : new Uint8Array()) as unknown as ArrayBuffer);
    const aba = wb.worksheets[0]!;
    const valores = (n: number) => (aba.getRow(n).values as unknown[]).slice(1).map((v) => (v === undefined || v === null ? null : String(v)));
    expect(valores(1)).toEqual(['Data da Operação', 'Usuário', 'Funcionalidade', 'Tipo de Operação', 'Descrição']);
    expect(valores(2)[0]).toContain('funcionalidade orc.exercicios');
    expect(valores(3).slice(1, 4)).toEqual(['ana.maria', 'orc.exercicios', 'ALTERACAO']);
    expect(aba.rowCount).toBe(3);
    const ultimo = await migrator.historicoOperacao.findFirstOrThrow({ where: { funcionalidade: 'adm.historico', tipoOperacao: 'EXPORTACAO' }, orderBy: { id: 'desc' } });
    expect(ultimo.descricao).toMatch(/^Exportou 1 registro\(s\) do Histórico: .*funcionalidade orc\.exercicios/);
  });

  it('acima de 5.000 linhas → recusa sem gerar nem registrar; sem a permissão → ErroPermissao', async () => {
    await migrator.$executeRaw`INSERT INTO historico_operacao (ocorrido_em, usuario_rotulo, funcionalidade, tipo_operacao, descricao)
      SELECT '2026-08-10T12:00:00Z'::timestamptz, 'Massa', 'adm.usuarios', 'INSERCAO'::"TipoOperacao", 'massa ' || g FROM generate_series(1, 5001) g`;
    const antes = await migrator.historicoOperacao.count({ where: { tipoOperacao: 'EXPORTACAO' } });
    expect(await exportarHistorico(exportador(), { de: new Date('2026-08-01T03:00:00Z'), ate: new Date('2026-08-31T03:00:00Z') }, deps())).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: MENSAGEM_EXPORTACAO_LIMITE }],
    });
    expect(await migrator.historicoOperacao.count({ where: { tipoOperacao: 'EXPORTACAO' } })).toBe(antes);
    await expect(exportarHistorico(admin, { de: DE, ate: ATE }, deps())).rejects.toBeInstanceOf(ErroPermissao);
  });

  it('registrarImpressao grava um IMPRESSAO com os filtros', async () => {
    expect(await registrarImpressao(exportador(), { de: DE, ate: ATE, tipo: 'LOGIN' }, deps())).toEqual({ ok: true, valor: undefined });
    const ultimo = await migrator.historicoOperacao.findFirstOrThrow({ where: { funcionalidade: 'adm.historico', tipoOperacao: 'IMPRESSAO' }, orderBy: { id: 'desc' } });
    expect(ultimo.descricao).toContain('tipo LOGIN');
  });
});
