import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { seedAdm } from '@/modules/adm';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import type { EntradaBeneficio } from '../domain/beneficios';
import { congelarPremissasExercicio, garantirPremissasExercicio } from '../infrastructure/premissas';
import { seedCad } from '../infrastructure/seed';
import { seedDadosReferenciaCad } from '../infrastructure/seed-referencia';
import { alterarBeneficioMestre, incluirBeneficioMestre } from './beneficios';
import { alterarBeneficiosCargo, listarBeneficiosCargo } from './beneficios-cargo';

// US-050 parte 2 (plano do P4, Task 13, Step 1): benefícios do cargo e a sobrescrita auditada pela
// Tabela Mestre (RN_CAR_06/07, C8), num Postgres real (Testcontainers, D12). Os testes dependem da
// ordem: o do congelamento, por último, deixa 2027 congelado.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: PrismaClient;
let migrator: pg.Client;
let usuarioId: string;
const cargos: Record<string, string> = {};

// "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: as permissões saem daqui.
const ctx = (...p: [string, string][]): ContextoRequisicao => ({ usuarioId, usuarioRotulo: 'grh', sessaoUid: 's', ip: '127.0.0.1', permissoes: new Set(p.map(([f, a]) => `${f}:${a}`)) });
const grh = () => ctx(['cad.cargos', 'consultar'], ['cad.cargos', 'alterar'], ['cad.salarios', 'consultar'], ['cad.beneficios', 'consultar'], ['cad.beneficios', 'alterar'], ['cad.beneficios', 'incluir']);
const SISTEMA = { usuarioId: null, usuarioRotulo: 'Sistema', sessaoUid: null, ip: null, unidadeId: null };

const versao = async (codigo: string) => (await migrator.query('SELECT versao FROM cargo WHERE codigo = $1', [codigo])).rows[0].versao as number;
const vr = async (ano = 2027) => (await migrator.query(`SELECT * FROM beneficio_mestre WHERE ano = $1 AND codigo = 'beneficio.vr'`, [ano])).rows[0];
const entradaVr = async (ano: number, valor: string): Promise<EntradaBeneficio> => {
  const m = await vr(ano);
  return { codigo: 'beneficio.vr', nome: m.nome, forma: m.forma, valor, percentual: null, conta: m.conta, padraoPosicao: m.padrao_posicao, ativo: m.ativo };
};
const manual = async (codigo: string, ano: number, valor: string) => {
  const r = await alterarBeneficiosCargo(grh(), cargos[codigo]!, ano, await versao(codigo), [{ codigo: 'beneficio.vr', ativo: true, valorManual: valor }], { cliente: app });
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
};
const linha = async (codigo: string, ano = 2027) =>
  (await migrator.query(`SELECT origem::text AS origem, valor_manual::text AS valor FROM beneficio_cargo WHERE cargo_id = $1 AND ano = $2 AND codigo = 'beneficio.vr'`, [cargos[codigo], ano])).rows[0];

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  const m = criarPrisma(banco.urlMigrator);
  vi.stubEnv('CARGA_DADOS_REFERENCIA', '1');
  vi.stubEnv('AMBIENTE', 'dev');
  await executarSeeds(m, [seedAdm, seedCad, seedDadosReferenciaCad]);
  vi.unstubAllEnvs();
  // 2028, copiado de 2027 (parâmetros e Tabela Mestre).
  await m.$transaction((tx) => garantirPremissasExercicio(tx, SISTEMA, 2028));
  await m.$disconnect();
  app = criarPrisma(banco.urlApp);
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  await migrator.connect();
  const { rows } = await migrator.query(`INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash) VALUES ('GRH', 'g@exemplo.org', 'g', 'g', 'x') RETURNING id`);
  usuarioId = rows[0].id;
  for (const c of ['C1', 'C2', 'C3']) cargos[c] = (await migrator.query(`INSERT INTO cargo (codigo, nome_oficial) VALUES ($1, $1) RETURNING id`, [c])).rows[0].id;
}, 180_000);

afterAll(async () => {
  await Promise.allSettled([app?.$disconnect(), migrator?.end()]);
  await banco?.parar();
});

beforeEach(async () => {
  await migrator.query('DELETE FROM beneficio_cargo');
});

describe('benefícios do cargo (RN_CAR_07)', () => {
  it('sem linha, os "padrão da posição" da Tabela Mestre; valor manual → MANUAL; vazio → MESTRE', async () => {
    const antes = await listarBeneficiosCargo(grh(), cargos.C1!, 2027, { cliente: app });
    expect(antes.itens.filter((i) => i.ativo).map((i) => i.codigo)).toEqual(['beneficio.saude_basico', 'beneficio.seguro_vida', 'beneficio.vr']);
    await manual('C1', 2027, '40,00');
    expect(await linha('C1')).toEqual({ origem: 'MANUAL', valor: '40.00' });
    const r = await alterarBeneficiosCargo(grh(), cargos.C1!, 2027, await versao('C1'), [{ codigo: 'beneficio.vr', ativo: true, valorManual: null }], { cliente: app });
    expect(r.ok).toBe(true);
    expect(await linha('C1')).toEqual({ origem: 'MESTRE', valor: null });
    // Sem cad.salarios, sem os valores.
    expect((await listarBeneficiosCargo(ctx(['cad.cargos', 'consultar']), cargos.C1!, 2027, { cliente: app })).mascarado).toBe(true);
  });

  it('percentual não tem valor manual; versão velha do cargo → concorrência', async () => {
    const conta = (await vr()).conta;
    const inc = await incluirBeneficioMestre(
      grh(),
      2027,
      { codigo: 'beneficio.previdencia', nome: 'Previdência', forma: 'PERCENTUAL_SALARIO', valor: null, percentual: '2', conta, padraoPosicao: false, ativo: true },
      { cliente: app },
    );
    if (!inc.ok) throw new Error(JSON.stringify(inc.erros));
    expect(await alterarBeneficiosCargo(grh(), cargos.C1!, 2027, await versao('C1'), [{ codigo: 'beneficio.previdencia', ativo: true, valorManual: '1' }], { cliente: app })).toEqual({
      ok: false,
      erros: [{ campo: 'itens.0.valorManual', mensagem: 'O benefício percentual não tem valor manual.' }],
    });
    expect(await alterarBeneficiosCargo(grh(), cargos.C1!, 2027, 999, [{ codigo: 'beneficio.vr', ativo: true, valorManual: null }], { cliente: app })).toMatchObject({ ok: false, erros: [{ mensagem: 'Este registro foi alterado por outro usuário. Recarregue a tela.' }] });
  });
});

describe('sobrescrita pela Tabela Mestre (RN_CAR_06, C8)', () => {
  it('3 cargos com VR manual voltam a MESTRE, com 3 Históricos; o de 2028 não muda', async () => {
    for (const c of ['C1', 'C2', 'C3']) await manual(c, 2027, '45');
    await manual('C1', 2028, '46');
    const r = await alterarBeneficioMestre(grh(), 2027, 'beneficio.vr', (await vr()).versao, await entradaVr(2027, '38.00'), { cliente: app });
    expect(r.ok).toBe(true);
    for (const c of ['C1', 'C2', 'C3']) expect(await linha(c)).toEqual({ origem: 'MESTRE', valor: null });
    expect(await linha('C1', 2028)).toEqual({ origem: 'MANUAL', valor: '46.00' });
    const h = await migrator.query(`SELECT registro_id FROM historico_operacao WHERE descricao LIKE 'Benefício beneficio.vr de 2027 do cargo % voltou ao valor da Tabela Mestre' ORDER BY registro_id`);
    expect(h.rows.map((x) => x.registro_id)).toEqual(['C1', 'C2', 'C3']);
  });

  it('atomicidade: com a auditoria falhando no 2º cargo, nada muda (nem a Tabela Mestre)', async () => {
    for (const c of ['C1', 'C2', 'C3']) await manual(c, 2027, '45');
    const antes = await vr();
    await migrator.query(`CREATE FUNCTION teste_falha() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.registro_id = 'C2' AND NEW.descricao LIKE '%voltou ao valor da Tabela Mestre' THEN RAISE EXCEPTION 'falha de auditoria (teste)'; END IF; RETURN NEW; END $$`);
    await migrator.query(`CREATE TRIGGER teste_falha BEFORE INSERT ON historico_operacao FOR EACH ROW EXECUTE FUNCTION teste_falha()`);
    try {
      await expect(alterarBeneficioMestre(grh(), 2027, 'beneficio.vr', antes.versao, await entradaVr(2027, '39.00'), { cliente: app })).rejects.toThrow(/falha de auditoria/);
    } finally {
      await migrator.query('DROP TRIGGER teste_falha ON historico_operacao');
      await migrator.query('DROP FUNCTION teste_falha()');
    }
    for (const c of ['C1', 'C2', 'C3']) expect(await linha(c)).toEqual({ origem: 'MANUAL', valor: '45.00' });
    expect((await vr()).versao).toBe(antes.versao);
  });

  it('congelado: com 2027 congelado, a alteração do cargo e a da Tabela Mestre são recusadas e nada muda (por último)', async () => {
    await manual('C1', 2027, '45');
    await migrator.query('BEGIN');
    try {
      const m = criarPrisma(banco.urlMigrator);
      await m.$transaction((tx) => congelarPremissasExercicio(tx, SISTEMA, 2027));
      await m.$disconnect();
    } finally {
      await migrator.query('COMMIT');
    }
    expect((await alterarBeneficiosCargo(grh(), cargos.C1!, 2027, await versao('C1'), [{ codigo: 'beneficio.vr', ativo: false, valorManual: null }], { cliente: app })).ok).toBe(false);
    expect((await alterarBeneficioMestre(grh(), 2027, 'beneficio.vr', (await vr()).versao, await entradaVr(2027, '50'), { cliente: app })).ok).toBe(false);
    expect(await linha('C1')).toEqual({ origem: 'MANUAL', valor: '45.00' });
  });
});
