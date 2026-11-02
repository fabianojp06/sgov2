import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { seedAdm } from '@/modules/adm';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { Dinheiro } from '@/shared/kernel';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { alterarBeneficioMestre } from '../application/beneficios';
import { calcularCustoPosicao, congelarPremissasExercicio, obterPremissasExercicio } from './premissas';
import { seedCad } from './seed';
import { seedDadosReferenciaCad } from './seed-referencia';

// C2 real (plano do P4, Task 11, Step 2), com Postgres real. Os testes compartilham o banco e
// dependem da ordem (o congelamento vem por último).
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: ReturnType<typeof criarPrisma>;
let sync: ReturnType<typeof criarPrisma>;
let migrator: pg.Client;
let usuarioId: string;
const SISTEMA = { usuarioId: null, usuarioRotulo: 'Sistema', sessaoUid: null, ip: null, unidadeId: null };
const grh = (): ContextoRequisicao => ({ usuarioId, usuarioRotulo: 'GRH', sessaoUid: 's', ip: '127.0.0.1', permissoes: new Set(['cad.beneficios:alterar']) });

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  const m = criarPrisma(banco.urlMigrator);
  vi.stubEnv('CARGA_DADOS_REFERENCIA', '1');
  vi.stubEnv('AMBIENTE', 'dev');
  await executarSeeds(m, [seedAdm, seedCad, seedDadosReferenciaCad]);
  vi.unstubAllEnvs();
  await m.$disconnect();
  app = criarPrisma(banco.urlApp);
  sync = criarPrisma(banco.urlMigrator.replace('sgo_migrator:sgo_migrator', 'sgo_sync:sgo_sync'));
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  await migrator.connect();
  const { rows } = await migrator.query(`INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash)
    VALUES ('GRH', 'grh@exemplo.org', 'grh', 'grh', 'x') RETURNING id`);
  usuarioId = rows[0].id;
}, 180_000);

afterAll(async () => {
  await Promise.allSettled([app?.$disconnect(), sync?.$disconnect(), migrator?.end()]);
  await banco?.parar();
});

describe('C2 real: premissas do exercício', () => {
  it('padrões do seed: provisório, encargos somando 51, sem benefícios e 3 avisos (VR, saúde e vida sem valor)', async () => {
    const p = (await obterPremissasExercicio(app, 2027))!;
    expect(p).toMatchObject({ ano: 2027, provisorio: true, congelado: false, beneficios: [] });
    expect(p.encargos.reduce((t, e) => t.plus(e.percentual.comoFracao()), p.encargos[0]!.percentual.comoFracao().times(0)).times(100).toString()).toBe('51');
    expect(p.avisos).toHaveLength(3);
    expect(p.avisos.join(' ')).toMatch(/Vale-refeição.*sem valor/);
  });

  it('VR diário de 36,50 preenchido → VALOR_MENSAL de 803,00 (22 dias úteis), e a versão muda', async () => {
    const antes = (await obterPremissasExercicio(app, 2027))!.versao;
    const r = await alterarBeneficioMestre(
      grh(),
      2027,
      'beneficio.vr',
      1,
      { codigo: 'beneficio.vr', nome: 'Vale-refeição', forma: 'VALOR_DIARIO', valor: '36.50', percentual: null, conta: '4.1.1.1.009', padraoPosicao: true, ativo: true },
      { cliente: app },
    );
    expect(r.ok).toBe(true);
    const p = (await obterPremissasExercicio(app, 2027))!;
    expect(p.versao).toBe(antes + 1);
    expect(p.beneficios).toEqual([expect.objectContaining({ componente: 'beneficio.vr', forma: 'VALOR_MENSAL', conta: '4.1.1.1.009' })]);
    expect(p.beneficios[0]!.forma === 'VALOR_MENSAL' && p.beneficios[0]!.valorMensal.paraString()).toBe('803.00');
    expect(p.avisos).toHaveLength(2);
  });

  it('com as premissas reais, o motor calcula e devolve a versão das premissas', async () => {
    const p = (await obterPremissasExercicio(app, 2027))!;
    const r = calcularCustoPosicao({ quantidade: 1, salarioMensal: Dinheiro.de('5000.00'), mesInicio: 1, mesSaida: 12 }, p);
    expect(r.ok && r.valor.versaoPremissas).toBe(p.versao);
    expect(r.ok && r.valor.linhas.map((l) => l.componente)).toContain('beneficio.vr');
  });

  it('ano inexistente → null', async () => {
    expect(await obterPremissasExercicio(app, 2050)).toBeNull();
  });

  it('conta inativada pela recarga → aviso nas premissas, e o cálculo recusa o componente', async () => {
    // A 4.1.1.1.005 (13º) sai do plano: como sgo_sync, inativa a analítica (a sintética continua com filhos).
    await sync.$executeRaw`UPDATE conta_contabil SET ativa = false, inativada_em = now() WHERE classificacao = '4.1.1.1.005'`;
    try {
      const p = (await obterPremissasExercicio(app, 2027))!;
      expect(p.contas.decimo_terceiro).toBe('');
      expect(p.avisos.some((a) => a.includes('4.1.1.1.005'))).toBe(true);
      const r = calcularCustoPosicao({ quantidade: 1, salarioMensal: Dinheiro.de('5000.00'), mesInicio: 1, mesSaida: 12 }, p);
      expect(r).toEqual({ ok: false, erros: [expect.objectContaining({ campo: 'premissas.contas.decimo_terceiro' })] });
    } finally {
      await sync.$executeRaw`UPDATE conta_contabil SET ativa = true, inativada_em = NULL WHERE classificacao = '4.1.1.1.005'`;
    }
  });

  it('ano congelado → congelado: true', async () => {
    await app.$transaction((tx) => congelarPremissasExercicio(tx, SISTEMA, 2027));
    expect((await obterPremissasExercicio(app, 2027))!.congelado).toBe(true);
  });
});
