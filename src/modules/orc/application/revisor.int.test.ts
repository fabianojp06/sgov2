import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedAdm } from '@/modules/adm';
import { custoPessoalFalso, estruturaFinanceiraFalsa, premissasExemplo } from '@/modules/cad/servidor';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { criarProvedorIAFalso, criarServicoIA, ErroIA, type CodigoErroIA, type ProvedorIA } from '@/shared/ia';
import { carregarPermissoes, manutencaoEfetiva, obterConfiguracaoAcesso, obterEscopoCentroCusto, obterUsuarioParaSessao } from '@/modules/adm/servidor';
import { Dinheiro } from '@/shared/kernel';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { seedOrc } from '../infrastructure/seed';
import { criarTrabalhadorRevisor } from '../infrastructure/trabalhador-revisor';
import { recalcularExercicio } from './calculo-linhas';
import { resolverDeps, type DepsOrc } from './deps';
import { CASOS_IA_ORC } from './ia-casos';
import { alterarPacote } from './pacotes';
import { pedirRevisao, ultimaRevisao } from './revisor';
import { LIMITE_ITENS_IA, processarRevisao, type DepsRevisor } from './revisor-processamento';

// O outbox pode falhar de propósito: a revisão não pode ficar gravada sem a mensagem (mesma transação).
const falhaOutbox = vi.hoisted(() => ({ ligada: false }));
vi.mock('@/shared/filas', async (original) => {
  const real = await original<typeof import('@/shared/filas')>();
  return {
    ...real,
    registrarNoOutbox: async (...args: Parameters<typeof real.registrarNoOutbox>) => {
      if (falhaOutbox.ligada) throw new Error('outbox indisponível');
      return real.registrarNoOutbox(...args);
    },
  };
});

// Revisor de consistência antes do envio (US-064; plano do P14, Task 3), num Postgres real: o pedido
// pela tela, o processamento do worker (sem a fila: processarRevisao direto) e a governança da IA com o
// provedor falso. CCs do falso do C1: 4.3.0, 4.3.2.10, 4.3.2.11 e 4.4; a conta de pacote é 4.1.1.5.005.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;
let ano = 2001;
let perfilGfin = '';

const CASO = CASOS_IA_ORC.revisor.codigo;
// "funcionalidade:ação" literal parece credencial para o GitGuardian: as permissões saem daqui.
const perm = (f: string, a: string) => [f, a].join(':');
const APROVACAO = [perm('orc.aprovacao', 'consultar'), perm('orc.aprovacao', 'executar')];
const PACOTES = ['consultar', 'incluir', 'alterar', 'excluir'].map((a) => perm('orc.pacotes', a));
// Quem vê tudo na revisão: pacotes, posições e salário (D-P12-3).
const VE_TUDO = [...APROVACAO, perm('orc.pacotes', 'consultar'), perm('orc.posicoes', 'consultar'), perm('orc.posicoes', 'alterar')];
// Salário de valor único, numa posição sozinha no CC 4.4: nenhum valor dela pode ir para a IA.
const SALARIO = '7777.77';

const ctx = (usuarioId: string, permissoes: string[] = APROVACAO): ContextoRequisicao => ({
  usuarioId,
  usuarioRotulo: 'u',
  sessaoUid: 's1',
  ip: null,
  unidadeId: null,
  permissoes: new Set(permissoes),
});

const falso = criarProvedorIAFalso({ estruturado: { achados: [] } });
const depsRev = (extra: Partial<DepsRevisor> = {}): Partial<DepsRevisor> & Pick<DepsRevisor, 'cliente'> => ({
  cliente: app,
  ia: criarServicoIA({ cliente: app, obterProvedor: () => falso }),
  estrutura: estruturaFinanceiraFalsa(),
  ...extra,
});

let seq = 0;
/** Uma pessoa com o perfil GFIN da seed; `sem` tira funcionalidades dela (exceção por usuário). */
async function gfin(sem: string[] = []) {
  const login = `gfin.revisor${++seq}`;
  const u = await migrator.usuario.create({ data: { nome: `Fulana Revisora ${seq}`, email: `${login}@exemplo.org`, login, loginNormalizado: login, senhaHash: 'x' } });
  await migrator.usuarioPerfil.create({ data: { usuarioId: u.id, perfilId: perfilGfin } });
  for (const f of sem) await migrator.usuarioExcecao.create({ data: { usuarioId: u.id, perfilId: perfilGfin, funcionalidadeCodigo: f } });
  return { id: u.id, login, nome: u.nome, email: u.email };
}

// Ano anterior oficializado, com o snapshot só das linhas (o que o revisor lê).
async function oficializarAnterior(a: number, solicitante: string, linhas: { cc: string; conta: string; origem: string; total: string }[]) {
  await migrator.$transaction(async (tx) => {
    const ex = await tx.orcamentoExercicio.create({ data: { ano: a } });
    await tx.$executeRaw`UPDATE orc_exercicio SET situacao = 'EM_ELABORACAO' WHERE id = ${ex.id}::uuid`;
    await tx.$executeRaw`UPDATE orc_exercicio SET situacao = 'EM_APROVACAO', enviado_por = ${solicitante}::uuid WHERE id = ${ex.id}::uuid`;
    await tx.$executeRaw`UPDATE orc_exercicio SET situacao = 'OFICIALIZADO', oficializado_em = now() WHERE id = ${ex.id}::uuid`;
    await tx.$executeRaw`INSERT INTO orc_tramite (exercicio_id, de, para, usuario_id) VALUES (${ex.id}::uuid, 'EM_APROVACAO', 'OFICIALIZADO', ${solicitante}::uuid)`;
    await tx.snapshotExercicio.create({ data: { exercicioId: ex.id, sha256: 'a'.repeat(64), conteudo: { ano: a, linhas } } });
  });
}

/**
 * Exercício Em Elaboração: a posição sozinha no 4.4, dois pacotes iguais no 4.3.0 (R1), um Desejável
 * de 30.000,00 no 4.3.2.11 e receita confirmada de 12.000,00 (orçado acima do teto: R3). Com o ano
 * anterior (R2): 10.000,00 no par 4.3.2.11 × 4.1.1.5.005 e 1,00 de pessoal no 4.4.
 */
async function exercicio(opcoes: { anterior?: boolean; solicitante: string }) {
  const a = ano;
  ano += 2;
  const custo = custoPessoalFalso([{ ...premissasExemplo(a), versao: 1 }]);
  const base: Partial<DepsOrc> = { cliente: app, estrutura: estruturaFinanceiraFalsa(), custoPessoal: custo, obterEscopo: async () => null };
  if (opcoes.anterior !== false) {
    await oficializarAnterior(a - 1, opcoes.solicitante, [
      { cc: '4.3.2.11', conta: '4.1.1.5.005', origem: 'BASE_ZERO', total: '10000.00' },
      { cc: '4.4', conta: '4.1.1.1.001', origem: 'PESSOAL', total: '1.00' },
    ]);
  }
  const e = await migrator.orcamentoExercicio.create({ data: { ano: a } });
  const posicao = await migrator.posicaoOrcada.create({
    data: { exercicioId: e.id, cc: '4.4', cargo: 'Analista', quantidade: 1, salarioMensal: SALARIO, mesInicio: 1, mesSaida: 12, origem: 'IMPORTACAO' },
  });
  const pacote = (cc: string, justificativa: string, prioridade: string, valor: string) =>
    migrator.pacoteBaseZero.create({
      data: { exercicioId: e.id, cc, conta: '4.1.1.5.005', justificativa, prioridade, quantidade: 1, valorUnitario: valor, corrigirIpca: false, distribuicao: 'MENSAL', origem: 'IMPORTACAO' },
    });
  const k1 = await pacote('4.3.0', 'Reposição de material de escritório', 'ESSENCIAL', '1200.00');
  const k2 = await pacote('4.3.0', '  REPOSIÇÃO de material   de escritorio', 'IMPORTANTE', '1200.00');
  const k3 = await pacote('4.3.2.11', 'Cadeiras novas para o setor de controle', 'DESEJAVEL', '30000.00');
  await migrator.receitaRateio.create({ data: { exercicioId: e.id, tp: '001', descricao: '', situacao: 'CONFIRMADO', meses: Array(12).fill('1000.00'), total: '12000.00' } });
  await app.$transaction((tx) => recalcularExercicio(tx, e.id, resolverDeps(base)));
  await migrator.$executeRaw`UPDATE orc_exercicio SET situacao = 'EM_ELABORACAO' WHERE id = ${e.id}::uuid`;
  const versao = async () => (await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { id: e.id } })).versao;
  return { ...e, ano: a, posicao, k1, k2, k3, base, versao };
}

const revisao = (id: string) => migrator.revisaoOrcamento.findUniqueOrThrow({ where: { id } });
async function pedir(e: { id: string; versao: () => Promise<number> }, usuarioId: string) {
  const r = await pedirRevisao(ctx(usuarioId), { id: e.id, versao: String(await e.versao()) }, { cliente: app, obterEscopo: async () => null });
  if (!r.ok) throw new Error(r.erros.map((x) => x.mensagem).join(' '));
  return r.valor.revisaoId;
}
const chamadas = async () =>
  (await migrator.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ia_chamada WHERE caso_uso_codigo = $1`, CASO))[0]!.n;

async function ligarCaso(ativo: boolean) {
  await migrator.$executeRawUnsafe(`UPDATE ia_caso_uso SET ativo = $1, teto_mensal_usd = 10 WHERE codigo = $2`, ativo, CASO);
}

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  await executarSeeds(migrator, [seedAdm, seedOrc]);
  app = criarPrisma(banco.urlApp);
  perfilGfin = (await migrator.perfil.findUniqueOrThrow({ where: { codigo: 'GFIN' } })).id;
  await migrator.$executeRawUnsafe(`UPDATE ia_configuracao SET habilitada = true, teto_mensal_usd = 100, limite_por_minuto = 1000`);
}, 120_000);

beforeEach(async () => {
  falso.roteiro.estruturado = { achados: [] };
  delete falso.roteiro.erro;
  falso.chamadas.length = 0;
  falhaOutbox.ligada = false;
  await ligarCaso(true);
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

describe('pedirRevisao', () => {
  it('sem orc.aprovacao:executar ou com CC de escopo: recusa no servidor', async () => {
    const p = await gfin();
    const e = await exercicio({ solicitante: p.id });
    const entrada = { id: e.id, versao: String(await e.versao()) };
    await expect(pedirRevisao(ctx(p.id, [perm('orc.aprovacao', 'consultar')]), entrada, { cliente: app, obterEscopo: async () => null })).rejects.toBeInstanceOf(ErroPermissao);
    await expect(pedirRevisao(ctx(p.id), entrada, { cliente: app, obterEscopo: async () => '4.3' })).rejects.toBeInstanceOf(ErroPermissao);
    expect(await migrator.revisaoOrcamento.count({ where: { exercicioId: e.id } })).toBe(0);
  });

  it('exercício fora de Em Elaboração ou versão velha: recusa', async () => {
    const p = await gfin();
    const e = await exercicio({ solicitante: p.id, anterior: false });
    const deps = { cliente: app, obterEscopo: async () => null };
    expect(await pedirRevisao(ctx(p.id), { id: e.id, versao: String((await e.versao()) - 1) }, deps)).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: MENSAGENS_ORC.ALTERADO_POR_OUTRO }],
    });
    await migrator.$executeRaw`UPDATE orc_exercicio SET situacao = 'EM_APROVACAO', enviado_por = ${p.id}::uuid WHERE id = ${e.id}::uuid`;
    expect(await pedirRevisao(ctx(p.id), { id: e.id, versao: String(await e.versao()) }, deps)).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: MENSAGENS_ORC.REVISAO_SO_EM_ELABORACAO }],
    });
    expect(await migrator.revisaoOrcamento.count({ where: { exercicioId: e.id } })).toBe(0);
  });

  it('grava a revisão PENDENTE e o outbox na mesma transação; um segundo pedido devolve a mesma', async () => {
    const p = await gfin();
    const e = await exercicio({ solicitante: p.id, anterior: false });
    const id = await pedir(e, p.id);
    expect(await revisao(id)).toMatchObject({ situacao: 'PENDENTE', versaoExercicio: await e.versao(), solicitadoPor: p.id, concluidoEm: null, avisos: [] });
    const outbox = await migrator.outboxMensagem.findMany({ where: { tipo: 'orc.revisar' } });
    expect(outbox.filter((m) => (m.dados as { revisaoId?: string }).revisaoId === id)).toHaveLength(1);
    expect(await pedir(e, p.id)).toBe(id);
    expect(await migrator.revisaoOrcamento.count({ where: { exercicioId: e.id } })).toBe(1);
    expect(await ultimaRevisao(ctx(p.id), e.id, { cliente: app, obterEscopo: async () => null })).toMatchObject({ situacao: 'PENDENTE', desatualizada: false });

    // Outbox falhou: nada gravado.
    const e2 = await exercicio({ solicitante: p.id, anterior: false });
    falhaOutbox.ligada = true;
    await expect(pedirRevisao(ctx(p.id), { id: e2.id, versao: String(await e2.versao()) }, { cliente: app, obterEscopo: async () => null })).rejects.toThrow('outbox indisponível');
    expect(await migrator.revisaoOrcamento.count({ where: { exercicioId: e2.id } })).toBe(0);
  });

  it('dois pedidos simultâneos geram uma revisão só', async () => {
    const p = await gfin();
    const e = await exercicio({ solicitante: p.id, anterior: false });
    const v = String(await e.versao());
    const deps = { cliente: app, obterEscopo: async () => null };
    const [a, b] = await Promise.all([pedirRevisao(ctx(p.id), { id: e.id, versao: v }, deps), pedirRevisao(ctx(p.id), { id: e.id, versao: v }, deps)]);
    expect(a.ok && b.ok && a.valor.revisaoId === b.valor.revisaoId).toBe(true);
    expect(await migrator.revisaoOrcamento.count({ where: { exercicioId: e.id } })).toBe(1);
  });

  it('a PENDENTE só é reaproveitada na mesma versão do exercício', async () => {
    const p = await gfin();
    const e = await exercicio({ solicitante: p.id, anterior: false });
    const id = await pedir(e, p.id);
    await migrator.$executeRaw`UPDATE orc_exercicio SET versao = versao + 1 WHERE id = ${e.id}::uuid`;
    const nova = await pedir(e, p.id);
    expect(nova).not.toBe(id);
    expect(await revisao(nova)).toMatchObject({ versaoExercicio: await e.versao() });
  });

  it('PENDENTE há mais de 15 minutos: aparece como FALHOU e aceita um pedido novo', async () => {
    const p = await gfin();
    const e = await exercicio({ solicitante: p.id, anterior: false });
    const id = await pedir(e, p.id);
    await migrator.$executeRaw`UPDATE orc_revisao SET criado_em = criado_em - interval '16 minutes' WHERE id = ${id}::uuid`;
    expect(await ultimaRevisao(ctx(p.id), e.id, { cliente: app, obterEscopo: async () => null })).toEqual({
      situacao: 'FALHOU',
      achados: [],
      avisos: [MENSAGENS_ORC.REVISAO_PARADA],
      desatualizada: false,
      concluidaEm: null,
    });
    const nova = await pedir(e, p.id);
    expect(nova).not.toBe(id);
    expect((await ultimaRevisao(ctx(p.id), e.id, { cliente: app, obterEscopo: async () => null }))?.situacao).toBe('PENDENTE');
  });

  it('ultimaRevisao: só com orc.aprovacao:executar; com CC de escopo, nada', async () => {
    const p = await gfin();
    const e = await exercicio({ solicitante: p.id, anterior: false });
    await pedir(e, p.id);
    await expect(ultimaRevisao(ctx(p.id, [perm('orc.aprovacao', 'consultar')]), e.id, { cliente: app, obterEscopo: async () => null })).rejects.toBeInstanceOf(ErroPermissao);
    expect(await ultimaRevisao(ctx(p.id), e.id, { cliente: app, obterEscopo: async () => '4.3' })).toBeNull();
  });
});

describe('processarRevisao', () => {
  it('caso desligado: CONCLUIDA só com as regras R1, R2 e R3 e o aviso, sem chamada; os links levam às linhas do exercício', async () => {
    await ligarCaso(false);
    const p = await gfin();
    const e = await exercicio({ solicitante: p.id });
    const id = await pedir(e, p.id);
    await processarRevisao(id, depsRev());
    const r = await revisao(id);
    expect(r.situacao).toBe('CONCLUIDA');
    expect(r.concluidoEm).not.toBeNull();
    expect(r.avisos).toEqual([MENSAGENS_ORC.REVISAO_IA_DESLIGADA]);
    expect(falso.chamadas).toHaveLength(0);
    const tela = await ultimaRevisao(ctx(p.id, VE_TUDO), e.id, { cliente: app, obterEscopo: async () => null });
    expect(tela?.achados.map((a) => [a.origem, a.tipo])).toEqual([
      ['REGRA', 'DUPLICADO'],
      ['REGRA', 'AUMENTO_ANO_ANTERIOR'],
      ['REGRA', 'AUMENTO_ANO_ANTERIOR'],
      ['REGRA', 'DESEJAVEIS_ACIMA_DO_TETO'],
    ]);
    const [dup, aumento, , teto] = tela!.achados;
    expect(dup!.links.map((l) => l.href).sort()).toEqual([e.k1.id, e.k2.id].map((k) => `/orc/pacotes?ano=${e.ano}&cc=4.3.0&editar=${k}`).sort());
    expect(aumento!.texto).toContain('CC 4.3.2.11, conta 4.1.1.5.005');
    expect(aumento!.links).toEqual([{ rotulo: 'Visão do CC 4.3.2.11', href: `/orc/orcamento?ano=${e.ano}&cc=4.3.2.11`, tipo: 'par', pessoal: false }]);
    expect(tela!.achados[2]!.links).toEqual([{ rotulo: 'Visão do CC 4.4', href: `/orc/orcamento?ano=${e.ano}&cc=4.4`, tipo: 'par', pessoal: true }]);
    expect(teto!.links).toEqual([{ rotulo: 'Pacote 4.3.2.11 · 4.1.1.5.005', href: `/orc/pacotes?ano=${e.ano}&cc=4.3.2.11&editar=${e.k3.id}`, tipo: 'pacote' }]);
    expect(tela!.desatualizada).toBe(false);

    // Depois de alterar um pacote, a revisão fica desatualizada.
    const dados = { cc: '4.3.0', conta: '4.1.1.5.005', justificativa: 'Reposição de material de escritório', prioridade: 'Essencial', quantidade: '2', valorUnitario: '1.200,00', corrigirIpca: 'Não', distribuicao: 'Mensal', mesOcorrencia: '' };
    const alterado = await alterarPacote(ctx(p.id, PACOTES), { ...dados, id: e.k1.id, versao: '0' }, e.base);
    expect(alterado.ok).toBe(true);
    expect((await ultimaRevisao(ctx(p.id), e.id, { cliente: app, obterEscopo: async () => null }))?.desatualizada).toBe(true);
  });

  it('sem ano anterior oficializado: a R2 não roda, com o aviso', async () => {
    await ligarCaso(false);
    const p = await gfin();
    const e = await exercicio({ solicitante: p.id, anterior: false });
    const id = await pedir(e, p.id);
    await processarRevisao(id, depsRev());
    const r = await revisao(id);
    expect(r.avisos).toEqual([MENSAGENS_ORC.REVISAO_SEM_ANTERIOR(e.ano - 1), MENSAGENS_ORC.REVISAO_IA_DESLIGADA]);
    expect((r.achados as { tipo: string }[]).map((a) => a.tipo)).toEqual(['DUPLICADO', 'DESEJAVEIS_ACIMA_DO_TETO']);
  });

  it('a IA: só o achado com id enviado fica, com origem IA; id inventado, de outro tipo ou sem referência válida sai', async () => {
    const p = await gfin();
    const e = await exercicio({ solicitante: p.id });
    falso.roteiro.estruturado = {
      achados: [
        { tipo: 'JUSTIFICATIVA_FRACA', referencias: [{ tipo: 'pacote', id: 'PAC-3' }, { tipo: 'pacote', id: 'PAC-99' }, { tipo: 'pacote', id: 'PAC-3' }], texto: 'A justificativa não diz quantas cadeiras.' },
        { tipo: 'OUTRO', referencias: [{ tipo: 'pacote', id: e.k1.id }], texto: 'Id real, mas não enviado.' },
        { tipo: 'OUTRO', referencias: [{ tipo: 'posicao', id: 'PAC-1' }], texto: 'Tipo trocado.' },
        { tipo: 'CONTA_INCOERENTE', referencias: [{ tipo: 'posicao', id: 'POS-1' }], texto: 'Cargo sem relação com o CC.' },
      ],
    };
    const id = await pedir(e, p.id);
    await processarRevisao(id, depsRev());
    const r = await revisao(id);
    expect(r.situacao).toBe('CONCLUIDA');
    expect(r.avisos).toEqual([]);
    expect(await chamadas()).toBeGreaterThan(0);
    const ia = (r.achados as { origem: string }[]).filter((a) => a.origem === 'IA');
    expect(ia).toEqual([
      {
        origem: 'IA',
        tipo: 'JUSTIFICATIVA_FRACA',
        texto: 'A justificativa não diz quantas cadeiras.',
        links: [{ rotulo: 'Pacote 4.3.2.11 · 4.1.1.5.005', href: `/orc/pacotes?ano=${e.ano}&cc=4.3.2.11&editar=${e.k3.id}`, tipo: 'pacote' }],
      },
      {
        origem: 'IA',
        tipo: 'CONTA_INCOERENTE',
        texto: 'Cargo sem relação com o CC.',
        links: [{ rotulo: 'Posição 4.4 · Analista', href: `/orc/posicoes?ano=${e.ano}&cc=4.4&editar=${e.posicao.id}`, tipo: 'posicao' }],
      },
    ]);
    // A chamada vai em nome da pessoa, nunca do sistema.
    const [linha] = await migrator.$queryRawUnsafe<{ usuario_id: string | null }[]>(
      `SELECT usuario_id::text FROM ia_chamada WHERE caso_uso_codigo = $1 ORDER BY criado_em DESC LIMIT 1`,
      CASO,
    );
    expect(linha?.usuario_id).toBe(p.id);
  });

  it('minimização: posição sozinha num CC sem salário (mensal, anual nem linhas), sem pessoal nos totais e sem dados de quem pediu', async () => {
    const p = await gfin();
    const e = await exercicio({ solicitante: p.id });
    const id = await pedir(e, p.id);
    await processarRevisao(id, depsRev());
    expect(falso.chamadas).toHaveLength(1);
    const { mensagem, instrucaoSistema } = falso.chamadas[0]!;
    expect(instrucaoSistema).toBe(CASOS_IA_ORC.revisor.instrucaoSistema);
    expect(mensagem).toContain('POS-1 | 4.4 | <<<Analista>>> | 1 | 1 | 12');
    expect(mensagem).toContain('<<<Cadeiras novas para o setor de controle>>>');
    expect(mensagem).toMatch(/4\.3\.2\.11 \| 4\.1\.1\.5\.005 \| R\$\s30\.000,00 \| R\$\s10\.000,00/);
    expect(mensagem).toContain('Aumento de mais de 50 % sobre o ano anterior: CC 4.3.2.11, conta 4.1.1.5.005');
    // Nenhum par com pessoal: nem nos totais, nem no achado da R2 (o 4.4 × 4.1.1.1.001 também aumentou).
    expect(mensagem).not.toMatch(/4\.4 \| 4\.1\.1\.[12]\./);
    expect(mensagem).not.toContain('CC 4.4, conta');
    const linhasPessoal = await migrator.linhaOrcada.findMany({ where: { posicaoId: e.posicao.id } });
    expect(linhasPessoal.length).toBeGreaterThan(0);
    const valores = [Dinheiro.de(SALARIO), Dinheiro.de(SALARIO).multiplicar('12'), Dinheiro.somarTodos(linhasPessoal.map((l) => Dinheiro.de(l.total.toString())))];
    for (const l of linhasPessoal) valores.push(Dinheiro.de(l.total.toString()), ...l.meses.map((m) => Dinheiro.de(m.toString())));
    for (const v of valores) {
      if (v.ehZero()) continue;
      const tela = v.formatar().replace(/^R\$\s/, '');
      expect(mensagem).not.toContain(tela);
      expect(mensagem).not.toContain(v.paraString());
    }
    for (const proibido of [p.nome, p.login, p.email, p.id]) expect(`${instrucaoSistema}\n${mensagem}`).not.toContain(proibido);
  });

  it('sem orc.posicoes:consultar: nenhuma posição na mensagem, com o aviso', async () => {
    const p = await gfin(['orc.posicoes']);
    const e = await exercicio({ solicitante: p.id });
    const id = await pedir(e, p.id);
    await processarRevisao(id, depsRev());
    expect(falso.chamadas).toHaveLength(1);
    expect(falso.chamadas[0]!.mensagem).not.toContain('POS-');
    expect(falso.chamadas[0]!.mensagem).not.toContain('Analista');
    expect((await revisao(id)).avisos).toEqual([MENSAGENS_ORC.REVISAO_SEM_POSICOES]);
  });

  it('sem orc.ia_revisor:executar: só as regras, com o aviso de ia.sem_permissao', async () => {
    const p = await gfin(['orc.ia_revisor']);
    const e = await exercicio({ solicitante: p.id });
    const id = await pedir(e, p.id);
    await processarRevisao(id, depsRev());
    const r = await revisao(id);
    expect(falso.chamadas).toHaveLength(0);
    expect(r.situacao).toBe('CONCLUIDA');
    expect(r.avisos).toEqual([MENSAGENS_ORC.REVISAO_ERRO_IA(new ErroIA('ia.sem_permissao').message)]);
    expect((r.achados as { origem: string }[]).every((a) => a.origem === 'REGRA')).toBe(true);
  });

  it('pessoa desativada entre o pedido e o processamento: sem chamada, só as regras, com o aviso', async () => {
    const p = await gfin();
    const e = await exercicio({ solicitante: p.id });
    const id = await pedir(e, p.id);
    await migrator.usuario.update({ where: { id: p.id }, data: { ativo: false } });
    await processarRevisao(id, depsRev());
    const r = await revisao(id);
    expect(falso.chamadas).toHaveLength(0);
    expect(r).toMatchObject({ situacao: 'CONCLUIDA', avisos: [MENSAGENS_ORC.REVISAO_SEM_ACESSO] });
    expect((r.achados as unknown[]).length).toBe(4);
  });

  it.each<[string, (p: { id: string }) => Promise<unknown>, string[]]>([
    ['bloqueada', (p) => migrator.usuario.update({ where: { id: p.id }, data: { bloqueado: true } }), []],
    ['que perdeu orc.aprovacao:executar', (p) => migrator.usuarioExcecao.create({ data: { usuarioId: p.id, perfilId: perfilGfin, funcionalidadeCodigo: 'orc.aprovacao' } }), []],
    ['que ganhou CC de escopo', (p) => migrator.usuario.update({ where: { id: p.id }, data: { ccEscopo: '4.3' } }), []],
  ])('pessoa %s entre o pedido e o processamento: sem chamada, só as regras, com o aviso', async (_nome, mudar) => {
    const p = await gfin();
    const e = await exercicio({ solicitante: p.id });
    const id = await pedir(e, p.id);
    await mudar(p);
    await processarRevisao(id, depsRev());
    expect(falso.chamadas).toHaveLength(0);
    expect(await revisao(id)).toMatchObject({ situacao: 'CONCLUIDA', avisos: [MENSAGENS_ORC.REVISAO_SEM_ACESSO] });
  });

  it('sistema em manutenção: sem chamada, só as regras, com o aviso', async () => {
    const p = await gfin();
    const e = await exercicio({ solicitante: p.id });
    const id = await pedir(e, p.id);
    await migrator.configuracaoAcesso.update({ where: { id: 1 }, data: { manutencao: true } });
    try {
      await processarRevisao(id, depsRev());
    } finally {
      await migrator.configuracaoAcesso.update({ where: { id: 1 }, data: { manutencao: false } });
    }
    expect(falso.chamadas).toHaveLength(0);
    expect(await revisao(id)).toMatchObject({ situacao: 'CONCLUIDA', avisos: [MENSAGENS_ORC.REVISAO_SEM_ACESSO] });
  });

  it('sem orc.pacotes:consultar: nem pacotes nem totais na mensagem, com o aviso', async () => {
    const p = await gfin(['orc.pacotes']);
    const e = await exercicio({ solicitante: p.id });
    const id = await pedir(e, p.id);
    await processarRevisao(id, depsRev());
    expect(falso.chamadas).toHaveLength(1);
    const m = falso.chamadas[0]!.mensagem;
    expect(m).not.toContain('PAC-');
    expect(m).not.toContain('Totais por CC');
    expect(m).not.toContain('Cadeiras novas');
    expect(m).toContain('POS-1');
    expect((await revisao(id)).avisos).toEqual([MENSAGENS_ORC.REVISAO_SEM_PACOTES]);
  });

  it('tempo esgotado: CONCLUIDA com o aviso do tempo, não o do cancelamento', async () => {
    const p = await gfin();
    const e = await exercicio({ solicitante: p.id, anterior: false });
    // Provedor lento: responde depois do tempo limite; a governança e o provedor real dão ia.cancelada.
    const lento: ProvedorIA = {
      ...falso,
      async gerarEstruturado(pedido, schema) {
        await new Promise((r) => setTimeout(r, 200));
        if (pedido.sinal?.aborted) throw new ErroIA('ia.cancelada');
        return falso.gerarEstruturado(pedido, schema);
      },
    };
    const id = await pedir(e, p.id);
    await processarRevisao(id, depsRev({ ia: criarServicoIA({ cliente: app, obterProvedor: () => lento }), sinalIa: () => AbortSignal.timeout(20) }));
    expect((await revisao(id)).avisos).toEqual([MENSAGENS_ORC.REVISAO_SEM_ANTERIOR(e.ano - 1), MENSAGENS_ORC.REVISAO_ERRO_IA(MENSAGENS_ORC.IA_TEMPO_ESGOTADO)]);
  });

  it('PENDENTE parada há mais de 15 minutos: o worker conclui como FALHOU, sem chamar a IA', async () => {
    const p = await gfin();
    const e = await exercicio({ solicitante: p.id, anterior: false });
    const id = await pedir(e, p.id);
    await migrator.$executeRaw`UPDATE orc_revisao SET criado_em = criado_em - interval '16 minutes' WHERE id = ${id}::uuid`;
    await processarRevisao(id, depsRev());
    expect(falso.chamadas).toHaveLength(0);
    expect(await revisao(id)).toMatchObject({ situacao: 'FALHOU', avisos: [MENSAGENS_ORC.REVISAO_PARADA], achados: [] });
  });

  it('erro depois das regras: FALHOU, mas com os achados das regras', async () => {
    const p = await gfin();
    const e = await exercicio({ solicitante: p.id, anterior: false });
    const id = await pedir(e, p.id);
    const pessoa = {
      obterUsuarioParaSessao,
      manutencaoEfetiva,
      obterConfiguracaoAcesso,
      obterEscopo: obterEscopoCentroCusto,
      carregarPermissoes: (async () => Promise.reject(new Error('banco fora'))) as unknown as typeof carregarPermissoes,
    };
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    await processarRevisao(id, depsRev({ pessoa }));
    erro.mockRestore();
    const r = await revisao(id);
    expect(r).toMatchObject({ situacao: 'FALHOU', avisos: [MENSAGENS_ORC.REVISAO_SEM_ANTERIOR(e.ano - 1), MENSAGENS_ORC.REVISAO_PARADA] });
    expect((r.achados as { tipo: string }[]).map((a) => a.tipo)).toEqual(['DUPLICADO', 'DESEJAVEIS_ACIMA_DO_TETO']);
  });

  it('a tela filtra pelo alcance de quem vê: duas pessoas, achados diferentes', async () => {
    const p = await gfin();
    const e = await exercicio({ solicitante: p.id });
    falso.roteiro.estruturado = {
      achados: [
        { tipo: 'JUSTIFICATIVA_FRACA', referencias: [{ tipo: 'pacote', id: 'PAC-3' }], texto: 'Pacote sem quantidade.' },
        { tipo: 'CONTA_INCOERENTE', referencias: [{ tipo: 'posicao', id: 'POS-1' }], texto: 'Posição estranha.' },
      ],
    };
    const id = await pedir(e, p.id);
    await processarRevisao(id, depsRev());
    const ver = async (permissoes: string[]) => (await ultimaRevisao(ctx(p.id, permissoes), e.id, { cliente: app, obterEscopo: async () => null }))!.achados.map((a) => a.texto);
    const tudo = await ver(VE_TUDO);
    expect(tudo).toHaveLength(6);
    expect(tudo).toEqual(expect.arrayContaining(['Pacote sem quantidade.', 'Posição estranha.']));
    // Consulta pacotes e posições, mas não vê salário: sai a R2 do par de pessoal (CC 4.4).
    const semSalario = await ver([...APROVACAO, perm('orc.pacotes', 'consultar'), perm('orc.posicoes', 'consultar')]);
    expect(semSalario).toHaveLength(5);
    expect(semSalario.some((t) => t.startsWith('CC 4.4,'))).toBe(false);
    // Só a aprovação: fica a R2 do par sem pessoal (os pacotes e as posições saem).
    const so = await ver(APROVACAO);
    expect(so).toEqual([expect.stringMatching(/^CC 4\.3\.2\.11, conta 4\.1\.1\.5\.005:/)]);
  });

  it.each<CodigoErroIA>(['ia.indisponivel', 'ia.teto_atingido', 'ia.limite_tokens', 'ia.saida_invalida', 'ia.desabilitada'])('%s: CONCLUIDA com as regras e o aviso com a mensagem do erro', async (codigo) => {
    const p = await gfin();
    const e = await exercicio({ solicitante: p.id, anterior: false });
    if (codigo === 'ia.saida_invalida') falso.roteiro.estruturado = { achados: [{ tipo: 'INVENTADO', referencias: [], texto: '' }] };
    else falso.roteiro.erro = codigo;
    const id = await pedir(e, p.id);
    await processarRevisao(id, depsRev());
    const r = await revisao(id);
    expect(r.situacao).toBe('CONCLUIDA');
    expect(r.avisos).toEqual([MENSAGENS_ORC.REVISAO_SEM_ANTERIOR(e.ano - 1), MENSAGENS_ORC.REVISAO_ERRO_IA(new ErroIA(codigo).message)]);
    expect((r.achados as { tipo: string }[]).map((a) => a.tipo)).toEqual(['DUPLICADO', 'DESEJAVEIS_ACIMA_DO_TETO']);
  });

  it('revisão já concluída: nada muda e nada é chamado (nova tentativa da fila é inofensiva)', async () => {
    const p = await gfin();
    const e = await exercicio({ solicitante: p.id, anterior: false });
    const id = await pedir(e, p.id);
    await processarRevisao(id, depsRev());
    const antes = await revisao(id);
    falso.chamadas.length = 0;
    await criarTrabalhadorRevisor(depsRev())({ revisaoId: id });
    expect(falso.chamadas).toHaveLength(0);
    expect(await revisao(id)).toEqual(antes);
    // O trigger também recusa reescrever a concluída.
    await expect(app.$executeRaw`UPDATE orc_revisao SET situacao = 'FALHOU' WHERE id = ${id}::uuid`).rejects.toThrow(/orc\.revisao_concluida/);
    // Pedido fora do formato: ignorado, sem erro.
    await expect(criarTrabalhadorRevisor(depsRev())({ outro: 1 })).resolves.toBeUndefined();
    await expect(processarRevisao('nao-e-uuid', depsRev())).resolves.toBeUndefined();
  });

  it('erro que não é de IA: FALHOU, com o aviso da revisão parada', async () => {
    const p = await gfin();
    const e = await exercicio({ solicitante: p.id, anterior: false });
    const id = await pedir(e, p.id);
    const quebrada = { ...estruturaFinanceiraFalsa(), listarArvoreContas: async () => Promise.reject(new Error('C1 fora do ar')) };
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    await processarRevisao(id, depsRev({ estrutura: quebrada }));
    expect(erro).toHaveBeenCalledWith('[ORC_REVISAO_FALHOU]', { revisaoId: id, erro: 'Error' });
    erro.mockRestore();
    const r = await revisao(id);
    expect(r).toMatchObject({ situacao: 'FALHOU', avisos: [MENSAGENS_ORC.REVISAO_PARADA], achados: [] });
    expect(r.concluidoEm).not.toBeNull();
  });

  it(`mais de ${LIMITE_ITENS_IA} itens: sem chamada, com o aviso`, async () => {
    const p = await gfin();
    const e = await exercicio({ solicitante: p.id, anterior: false });
    await migrator.pacoteBaseZero.createMany({
      data: Array.from({ length: LIMITE_ITENS_IA - 3 }, (_, i) => ({
        exercicioId: e.id,
        cc: '4.3.2.10',
        conta: '4.1.1.5.005',
        justificativa: `Pacote de volume número ${i}`,
        prioridade: 'IMPORTANTE',
        quantidade: 1,
        valorUnitario: '1.00',
        corrigirIpca: false,
        distribuicao: 'MENSAL',
        origem: 'IMPORTACAO',
      })),
    });
    const id = await pedir(e, p.id);
    await processarRevisao(id, depsRev());
    const r = await revisao(id);
    expect(falso.chamadas).toHaveLength(0);
    expect(r.situacao).toBe('CONCLUIDA');
    expect(r.avisos).toContain(MENSAGENS_ORC.REVISAO_GRANDE);
  });
});
