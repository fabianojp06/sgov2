import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { seedAdm } from '@/modules/adm';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { criarProvedorIAFalso, criarServicoIA } from '@/shared/ia';
import { Dinheiro } from '@/shared/kernel';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import type { TpEntrada } from '../domain/comparativo-tps';
import { seedRel } from '../infrastructure/seed';
import { comentarComparativo, comentariosComparativoLiberados, limparCacheComparativo, MENSAGENS_COMPARATIVO, obterComparativo } from './comparativo-tps';
import { CASO_COMPARATIVO_TPS } from './ia-casos';

// Comparativo entre TPs (US-106) num Postgres real (Testcontainers, D12): a seed (menu da Adm. Central) e a
// governança da IA (US-019) com o provedor falso. A leitura dos TPs é a do orc (#513), aqui substituída por
// um falso no mesmo formato: a permissão, o Histórico e a RLS dela são testados pela frente A.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: PrismaClient;
let app: PrismaClient;
let usuarioId = '';
let casoInicial = { ativo: true, teto: false };

// "funcionalidade:ação" literal parece credencial para o GitGuardian: as permissões saem daqui.
const perm = (f: string, a: string) => [f, a].join(':');
const IA = perm(CASO_COMPARATIVO_TPS.funcionalidade, 'executar');
const CONSULTA = perm(CASO_COMPARATIVO_TPS.funcionalidade, 'consultar');
const CONSOLIDADO = perm('orc.consolidado', 'consultar');
const ctx = (permissoes: string[] = [IA, CONSULTA, CONSOLIDADO]): ContextoRequisicao => ({
  usuarioId,
  usuarioRotulo: 'direx',
  sessaoUid: 's1',
  ip: null,
  unidadeId: null,
  permissoes: new Set(permissoes),
});

const d = (v: string) => Dinheiro.de(v);
const tp = (numero: string, pessoal: string, postos = 10): TpEntrada => ({
  numero,
  tipo: 'TERMO_PARCERIA',
  situacao: 'OFICIALIZADO',
  oficial: true,
  vigencia: { inicio: '2027-01', fim: '2027-12' },
  valorGlobal: d('100000.00'),
  porCategoria: { pessoal: d(pessoal), viagens: d('1000.00'), bens: d('0'), rateioAdmCentral: d('5000.00'), outros: d('0') },
  metas: [{ numero: 'M1', valor: d('100000.00') }],
  realizado: d('0'),
  postos,
  pessoalCalculado: true,
  custosPessoaDistintos: 3,
});
let lidas = 0;
const ler = async () => (
  lidas++,
  [
    ...['50000.00', '51000.00', '52000.00', '53000.00', '54000.00', '55000.00', '56000.00'].map((p, i) => tp(`TP-${i}`, p)),
    tp('TP-ALTO', '95000.00'),
    tp('TP-PEQ', '43210.98', 2),
  ]
);
const falso = criarProvedorIAFalso();
const deps = () => ({ ler, ia: criarServicoIA({ cliente: app, obterProvedor: () => falso }) });
const RESPOSTA = { resumo: 'Portfólio com um TP fora da curva no pessoal.', destaques: [], alertas: ['TP-ALTO: pessoal acima da curva.'] };
const ligarCaso = (ativo: boolean) => migrator.$executeRawUnsafe(`UPDATE ia_caso_uso SET ativo = $1, teto_mensal_usd = 10 WHERE codigo = $2`, ativo, CASO_COMPARATIVO_TPS.codigo);

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  await executarSeeds(migrator, [seedAdm, seedRel]);
  const c = await migrator.iaCasoUso.findUniqueOrThrow({ where: { codigo: CASO_COMPARATIVO_TPS.codigo } });
  casoInicial = { ativo: c.ativo, teto: c.tetoMensalUsd.isZero() };
  app = criarPrisma(banco.urlApp);
  usuarioId = (await migrator.usuario.create({ data: { nome: 'DIREX', email: 'direx@exemplo.org', login: 'direx', loginNormalizado: 'direx', senhaHash: 'x' } })).id;
  await migrator.$executeRawUnsafe(`UPDATE ia_configuracao SET habilitada = true, teto_mensal_usd = 100, limite_por_minuto = 100`);
}, 180_000);

beforeEach(async () => {
  limparCacheComparativo();
  falso.roteiro.estruturado = RESPOSTA;
  delete falso.roteiro.erro;
  falso.chamadas.length = 0;
  await ligarCaso(true);
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

describe('seed do comparativo entre TPs', () => {
  it('no menu da Administração Central, para DIREX e GFIN; o caso nasce desligado e com teto zero', async () => {
    expect(casoInicial).toEqual({ ativo: false, teto: true });
    const f = await migrator.funcionalidade.findUniqueOrThrow({ where: { codigo: CASO_COMPARATIVO_TPS.funcionalidade } });
    expect(f).toMatchObject({ moduloCodigo: 'ADM_CENTRAL', rota: '/rel/comparativo-tps', exibirNoMenu: true });
    const perfis = await migrator.perfilPermissao.findMany({
      where: { funcionalidadeCodigo: CASO_COMPARATIVO_TPS.funcionalidade, acao: 'executar' },
      select: { perfil: { select: { codigo: true } } },
    });
    expect(perfis.map((p) => p.perfil.codigo).sort()).toEqual(['DIREX', 'GFIN']);
  });
});

describe('comentarComparativo', () => {
  it('manda à IA só os indicadores e as marcas; os pesos do TP com 2 postos não vão', async () => {
    const r = await comentarComparativo(ctx(), deps());
    expect(r).toMatchObject({ ok: true, valor: { analise: RESPOSTA } });
    const m = falso.chamadas.at(-1)!.mensagem;
    expect(m).toContain('"TP-ALTO"');
    expect(m).toContain('"ACIMA"');
    expect(m).toContain('"POUCOS_POSTOS"');
    expect(m).not.toContain('43210');
    expect(m).not.toContain('43.21');
  });

  it('sem a permissão do caso, sem o consolidado ou com o caso desligado: recusa sem ler (a leitura grava no Histórico)', async () => {
    const antes = lidas;
    expect(await comentarComparativo(ctx([CONSULTA, CONSOLIDADO]), deps())).toMatchObject({ ok: false });
    expect(await comentarComparativo(ctx([IA, CONSULTA]), deps())).toEqual({ ok: false, erros: [{ campo: '_', mensagem: MENSAGENS_COMPARATIVO.SEM_CONSOLIDADO }] });
    await ligarCaso(false);
    expect(await comentariosComparativoLiberados(ctx(), deps())).toBe(false);
    expect(await comentarComparativo(ctx(), deps())).toMatchObject({ ok: false });
    expect(lidas).toBe(antes);
    expect(falso.chamadas).toHaveLength(0);
    expect(await obterComparativo(ctx([CONSULTA]), deps())).toEqual({ ok: false, erros: [{ campo: '_', mensagem: MENSAGENS_COMPARATIVO.SEM_CONSOLIDADO }] });
  });

  it('revisão 12.12 (I3): a mesma pessoa, dentro de 60 s, não relê nem grava de novo; os comentários reaproveitam a leitura', async () => {
    const antes = lidas;
    await obterComparativo(ctx(), deps());
    await obterComparativo(ctx(), deps());
    expect((await comentarComparativo(ctx(), deps())).ok).toBe(true);
    expect(lidas).toBe(antes + 1);
  });

  it('sem TPs: a mensagem, sem chamar a IA; erro do provedor vira a mensagem fixa', async () => {
    expect(await comentarComparativo(ctx(), { ...deps(), ler: async () => [] })).toEqual({ ok: false, erros: [{ campo: '_', mensagem: MENSAGENS_COMPARATIVO.SEM_TPS }] });
    expect(falso.chamadas).toHaveLength(0);
    limparCacheComparativo();
    falso.roteiro.erro = 'ia.indisponivel';
    expect(await comentarComparativo(ctx(), deps())).toEqual({ ok: false, erros: [{ campo: '_', mensagem: 'A IA está indisponível no momento. Tente de novo mais tarde.' }] });
  });
});
