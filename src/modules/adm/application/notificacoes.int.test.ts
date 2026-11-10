import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONTAS_EXEMPLO, type NoConta } from '@/modules/cad/servidor';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { MENSAGENS_NOTIFICACAO } from '../domain/notificacao';
import { seedAdm } from '../infrastructure/seed';
import { excluirNotificacao, incluirNotificacao, listarNotificacoes, listarOpcoesNotificacao } from './notificacoes';

// Notificações de desempenho (US-041, UC02.20 "Desempenho"; D-P10-8/9): conta sintética ativa do C1
// ou "Todas", usuário ativo, faixas, duplicado (A3) inclusive na corrida, soft delete e Histórico.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;
const AGORA = new Date('2026-11-11T12:00:00.000Z');
const PERMISSOES = ['adm.notificacoes:consultar', 'adm.notificacoes:incluir', 'adm.notificacoes:excluir'];
let ctx: ContextoRequisicao;

// O C1 vem pelo deps (o plano de contas é da frente B): trecho real do plano, com ENCARGOS SOCIAIS
// (4.1.1.2) inativa para o caso da conta sintética inativa.
const inativar = (alvo: string) => (n: NoConta): NoConta => ({ ...n, ativa: n.classificacao.startsWith(alvo) ? false : n.ativa, filhos: n.filhos.map(inativar(alvo)) });
let arvore: readonly NoConta[] = CONTAS_EXEMPLO.map(inativar('4.1.1.2'));
const deps = () => ({ cliente: app, agora: () => AGORA, contas: async () => arvore });

async function usuario(login: string, ativo = true): Promise<string> {
  const u = await migrator.usuario.create({
    data: { nome: `Nome ${login}`, email: `${login}@example.org`, login, loginNormalizado: login, senhaHash: 'x', trocaSenhaObrigatoria: false, ativo },
  });
  return u.id;
}

const entrada = (usuarioId: string, conta: string | null = '4.1.1', limite = '80', frequenciaDias: number | string = 7) => ({ conta, limite, frequenciaDias, usuarioId });

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  await executarSeeds(migrator, [seedAdm]);
  const admin = await usuario('adm.notif');
  ctx = { usuarioId: admin, usuarioRotulo: 'adm.notif', sessaoUid: 's1', ip: null, permissoes: new Set(PERMISSOES) };
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

const historico = (registroId: string) =>
  migrator.historicoOperacao.findMany({ where: { funcionalidade: 'adm.notificacoes', registroId }, orderBy: { id: 'asc' }, select: { tipoOperacao: true, antes: true, depois: true } });
const idDe = (r: { ok: boolean; valor?: { id: string } }) => (r.ok && r.valor ? r.valor.id : '');
const erro = (campo: string, mensagem: string) => ({ ok: false, erros: [{ campo, mensagem }] });

describe('inclusão (UC02.20, A1)', () => {
  it('conta sintética ativa, limite com vírgula decimal → gravada ativa, com o Histórico', async () => {
    const u = await usuario('dest.um');
    const r = await incluirNotificacao(ctx, entrada(u, '4.1.1', '80,5', '30'), deps());
    expect(r.ok).toBe(true);
    const id = idDe(r);
    const linha = await migrator.notificacaoDesempenho.findUniqueOrThrow({ where: { id } });
    expect(linha).toMatchObject({ contaClassificacao: '4.1.1', frequenciaDias: 30, usuarioId: u, ativa: true, inativadaEm: null, ultimoEnvioEm: null, criadaEm: AGORA, versao: 1 });
    expect(linha.limitePercentual.toString()).toBe('80.5');
    expect(await historico(id)).toEqual([{ tipoOperacao: 'INSERCAO', antes: null, depois: { conta: '4.1.1', limite: '80.5', frequenciaDias: 30, usuarioId: u } }]);
  });

  it('"Todas" (RN0051) grava a conta nula; "Todas" e uma conta específica para o mesmo usuário convivem', async () => {
    const u = await usuario('dest.todas');
    const todas = await incluirNotificacao(ctx, entrada(u, null), deps());
    expect(todas.ok).toBe(true);
    expect((await migrator.notificacaoDesempenho.findUniqueOrThrow({ where: { id: idDe(todas) } })).contaClassificacao).toBeNull();
    expect((await incluirNotificacao(ctx, entrada(u, '4'), deps())).ok).toBe(true);
    // "Todas" duplicado também é recusado (o índice trata o nulo como valor).
    expect(await incluirNotificacao(ctx, entrada(u, '*'), deps())).toEqual(erro('conta', MENSAGENS_NOTIFICACAO.DUPLICADA));
  });

  it('conta analítica, inexistente ou sintética inativa → recusada (Review Focus 4)', async () => {
    const u = await usuario('dest.conta');
    for (const conta of ['4.1.1.1.001', '9.9', '4.1.1.2']) {
      expect(await incluirNotificacao(ctx, entrada(u, conta), deps())).toEqual(erro('conta', MENSAGENS_NOTIFICACAO.CONTA_INVALIDA));
    }
    expect(await migrator.notificacaoDesempenho.count({ where: { usuarioId: u } })).toBe(0);
  });

  it('limite e frequência fora da faixa → recusados, sem gravar', async () => {
    const u = await usuario('dest.faixa');
    expect(await incluirNotificacao(ctx, entrada(u, '4.1', '0'), deps())).toEqual(erro('limite', MENSAGENS_NOTIFICACAO.LIMITE));
    expect(await incluirNotificacao(ctx, entrada(u, '4.1', '80,555'), deps())).toEqual(erro('limite', MENSAGENS_NOTIFICACAO.LIMITE));
    expect(await incluirNotificacao(ctx, entrada(u, '4.1', '1000'), deps())).toEqual(erro('limite', MENSAGENS_NOTIFICACAO.LIMITE));
    expect(await incluirNotificacao(ctx, entrada(u, '4.1', '80', 366), deps())).toEqual(erro('frequenciaDias', MENSAGENS_NOTIFICACAO.FREQUENCIA));
    expect((await incluirNotificacao(ctx, entrada(u, '4.1', '999,99', 365), deps())).ok).toBe(true);
  });

  it('usuário inativo ou inexistente → recusado (RN0086); vários usuários na mesma conta (RN0036)', async () => {
    const inativo = await usuario('dest.inativo', false);
    expect(await incluirNotificacao(ctx, entrada(inativo, '4.1.1.5'), deps())).toEqual(erro('usuarioId', MENSAGENS_NOTIFICACAO.USUARIO_INATIVO));
    expect(await incluirNotificacao(ctx, entrada('00000000-0000-4000-8000-000000000000', '4.1.1.5'), deps())).toEqual(erro('usuarioId', MENSAGENS_NOTIFICACAO.USUARIO_INATIVO));
    expect(await incluirNotificacao(ctx, entrada('', '4.1.1.5'), deps())).toEqual(erro('usuarioId', MENSAGENS_NOTIFICACAO.USUARIO));
    const [a, b] = [await usuario('dest.a'), await usuario('dest.b')];
    expect((await incluirNotificacao(ctx, entrada(a, '4.1.1.5'), deps())).ok).toBe(true);
    expect((await incluirNotificacao(ctx, entrada(b, '4.1.1.5'), deps())).ok).toBe(true);
    expect(await migrator.notificacaoDesempenho.count({ where: { contaClassificacao: '4.1.1.5', ativa: true } })).toBe(2);
  });

  it('duplicado usuário + conta → mensagem do A3; dois paralelos → um só ativo (Review Focus 5)', async () => {
    const u = await usuario('dest.dup');
    expect((await incluirNotificacao(ctx, entrada(u, '4.1'), deps())).ok).toBe(true);
    expect(await incluirNotificacao(ctx, entrada(u, '4.1', '50', 1), deps())).toEqual(erro('conta', MENSAGENS_NOTIFICACAO.DUPLICADA));

    const v = await usuario('dest.corrida');
    const rs = await Promise.all([incluirNotificacao(ctx, entrada(v, '4.1'), deps()), incluirNotificacao(ctx, entrada(v, '4.1', '90'), deps())]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.filter((r) => !r.ok)).toEqual([erro('conta', MENSAGENS_NOTIFICACAO.DUPLICADA)]);
    expect(await migrator.notificacaoDesempenho.count({ where: { usuarioId: v, ativa: true } })).toBe(1);
  });

  it('o índice parcial barra o duplicado mesmo sem a checagem do caso de uso', async () => {
    const u = await usuario('dest.indice');
    const inserir = (conta: string | null) =>
      migrator.$executeRaw`INSERT INTO adm_notificacao_desempenho (conta_classificacao, limite_percentual, frequencia_dias, usuario_id, criada_em) VALUES (${conta}, 10, 1, ${u}::uuid, now())`;
    await inserir(null);
    await expect(inserir(null)).rejects.toThrow(/conta_usuario_ativa_key/);
    await inserir('4.1');
    await expect(inserir('4.1')).rejects.toThrow(/conta_usuario_ativa_key/);
  });

  it('sem a permissão → ErroPermissao', async () => {
    const semPermissao = { ...ctx, permissoes: new Set(['adm.notificacoes:consultar']) };
    await expect(incluirNotificacao(semPermissao, entrada(ctx.usuarioId), deps())).rejects.toBeInstanceOf(ErroPermissao);
    await expect(excluirNotificacao(semPermissao, '00000000-0000-4000-8000-000000000000', 1, deps())).rejects.toBeInstanceOf(ErroPermissao);
    await expect(listarNotificacoes({ ...ctx, permissoes: new Set() }, deps())).rejects.toBeInstanceOf(ErroPermissao);
  });
});

describe('exclusão e grade (A4, RN0085, soft delete)', () => {
  it('excluir inativa e grava o Histórico; versão velha → conflito; já excluída → mensagem; a grade só mostra as ativas', async () => {
    const u = await usuario('dest.exclui');
    const id = idDe(await incluirNotificacao(ctx, entrada(u, '4.1.1.1', '75,25', 15), deps()));
    expect((await listarNotificacoes(ctx, deps())).find((l) => l.id === id)).toEqual({
      id,
      conta: '4.1.1.1',
      contaRotulo: '4.1.1.1 – DESPESAS DE PESSOAL',
      contaAviso: null,
      limite: '75,25%',
      frequenciaDias: 15,
      usuario: { id: u, nome: 'Nome dest.exclui', ativo: true },
      versao: 1,
    });
    expect(await excluirNotificacao(ctx, id, 0, deps())).toEqual(erro('_', MENSAGENS_NOTIFICACAO.ALTERADO));
    expect(await excluirNotificacao(ctx, id, 1, deps())).toEqual({ ok: true, valor: undefined });
    expect(await migrator.notificacaoDesempenho.findUniqueOrThrow({ where: { id } })).toMatchObject({ ativa: false, inativadaEm: AGORA, versao: 2 });
    expect(await historico(id)).toEqual([
      expect.objectContaining({ tipoOperacao: 'INSERCAO' }),
      { tipoOperacao: 'EXCLUSAO', antes: { conta: '4.1.1.1', limite: '75.25', frequenciaDias: 15, usuarioId: u }, depois: null },
    ]);
    expect(await excluirNotificacao(ctx, id, 2, deps())).toEqual(erro('_', MENSAGENS_NOTIFICACAO.INATIVA));
    expect((await listarNotificacoes(ctx, deps())).some((l) => l.id === id)).toBe(false);
    // Excluída, a mesma conta pode ser incluída de novo para o usuário.
    expect((await incluirNotificacao(ctx, entrada(u, '4.1.1.1'), deps())).ok).toBe(true);
    await expect(excluirNotificacao(ctx, '00000000-0000-4000-8000-000000000000', 1, deps())).rejects.toMatchObject({ codigo: 'adm.notificacao_inexistente' });
    await expect(excluirNotificacao(ctx, 'nao-e-uuid', 1, deps())).rejects.toMatchObject({ codigo: 'adm.notificacao_inexistente' });
  });

  it('ordem da grade: "Todas" primeiro, depois as contas pela classificação e o usuário pelo nome', async () => {
    const linhas = await listarNotificacoes(ctx, deps());
    const contas = linhas.map((l) => l.conta);
    expect(contas[0]).toBeNull();
    const comConta = contas.filter((c): c is string => c !== null);
    expect(comConta.indexOf('4')).toBeLessThan(comConta.indexOf('4.1'));
    expect(comConta.indexOf('4.1.1.1')).toBeLessThan(comConta.indexOf('4.1.1.5'));
    expect(linhas.find((l) => l.conta === null)?.contaRotulo).toBe('Todas');
  });

  it('conta que deixou de existir ou ficou inativa no C1 → a linha continua, com o aviso', async () => {
    const u = await usuario('dest.sumiu');
    const id = idDe(await incluirNotificacao(ctx, entrada(u, '4.1.1.5'), deps()));
    const antes = arvore;
    try {
      arvore = CONTAS_EXEMPLO.map(inativar('4.1.1.5'));
      expect((await listarNotificacoes(ctx, deps())).find((l) => l.id === id)).toMatchObject({ contaRotulo: '4.1.1.5 – DESPESAS ADMINISTRATIVAS', contaAviso: MENSAGENS_NOTIFICACAO.CONTA_INEXISTENTE });
      arvore = [];
      expect((await listarNotificacoes(ctx, deps())).find((l) => l.id === id)).toMatchObject({ contaRotulo: '4.1.1.5', contaAviso: MENSAGENS_NOTIFICACAO.CONTA_INEXISTENTE });
    } finally {
      arvore = antes;
    }
  });

  it('opções do formulário: só sintéticas ativas, com "Todas" de fora (a tela a acrescenta), e só usuários ativos', async () => {
    const o = await listarOpcoesNotificacao(ctx, deps());
    expect(o.contas.map((c) => c.classificacao)).toEqual(['4', '4.1', '4.1.1', '4.1.1.1', '4.1.1.5']);
    expect(o.contas[1]).toEqual({ classificacao: '4.1', rotulo: '4.1 – DESPESAS OPERACIONAIS', nivel: 2 });
    expect(o.usuarios.some((x) => x.nome === 'Nome dest.inativo')).toBe(false);
    expect(o.usuarios.some((x) => x.nome === 'Nome dest.um')).toBe(true);
  });

  it('CHECKs do banco: limite, frequência, classificação e inativação incoerente', async () => {
    const u = await usuario('dest.check');
    const inserir = (conta: string | null, limite: string, dias: number, ativa: boolean, inativadaEm: Date | null) =>
      migrator.$executeRaw`INSERT INTO adm_notificacao_desempenho (conta_classificacao, limite_percentual, frequencia_dias, usuario_id, ativa, inativada_em, criada_em)
        VALUES (${conta}, ${limite}::numeric, ${dias}, ${u}::uuid, ${ativa}, ${inativadaEm}, now())`;
    await expect(inserir('4.1', '0', 1, false, AGORA)).rejects.toThrow(/limite_check/);
    await expect(inserir('4.1', '1000', 1, false, AGORA)).rejects.toThrow(/limite_check|overflow/);
    await expect(inserir('4.1', '10', 0, false, AGORA)).rejects.toThrow(/frequencia_check/);
    await expect(inserir('4.1', '10', 366, false, AGORA)).rejects.toThrow(/frequencia_check/);
    await expect(inserir('x;1', '10', 1, false, AGORA)).rejects.toThrow(/conta_check/);
    await expect(inserir('4.1', '10', 1, false, null)).rejects.toThrow(/inativacao_check/);
  });
});
