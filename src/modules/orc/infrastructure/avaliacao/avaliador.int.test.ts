import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedAdm } from '@/modules/adm';
import { custoPessoalFalso, estruturaFinanceiraFalsa, premissasExemplo, type NoConta } from '@/modules/cad/servidor';
import { registrarTrabalhadoresInt } from '@/modules/int/servidor';
import { criarPrisma, executarSeeds } from '@/shared/db';
import type { FilaGerenciada } from '@/shared/filas';
import { criarProvedorIAFalso, criarServicoIA, ErroIA, FILA_AVALIACAO_IA, type AvaliadorCasoIA } from '@/shared/ia';
import { ErroDominio } from '@/shared/kernel';
import { iniciarBancoTeste } from '../../../../../tests/integracao/banco';
import { CASOS_IA_ORC } from '../../application/ia-casos';
import { FUNCOES_PESSOA_IA } from '../../application/ia-pessoa';
import { seedOrc } from '../seed';
import { criarAvaliadorSugestaoConta, MSG_AVALIACAO_SEM_ACESSO, type DepsAvaliadorSugestaoConta } from './avaliador';

// Avaliador da sugestão de conta na fila ia.avaliar (US-062, #403), num Postgres real: a pessoa
// remontada do banco (perfil GFIN da seed), a governança da frente B (servicoIA) com o provedor falso e
// o trabalhador genérico do int. CCs do falso do C1: 4.3.0, 4.3.2.10, 4.3.2.11 e 4.4 (analíticos).
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;
let perfilGfin = '';
const ANO = 2090;

const CASO = CASOS_IA_ORC.sugestaoConta.codigo;

const analitica = (classificacao: string, descricao: string): NoConta => ({ classificacao, codigoReduzido: '1', descricao, nivel: 5, tipo: 'ANALITICA', ativa: true, filhos: [] });
const sintetica = (classificacao: string, descricao: string, filhos: NoConta[]): NoConta => ({
  classificacao,
  codigoReduzido: null,
  descricao,
  nivel: classificacao.split('.').length as NoConta['nivel'],
  tipo: 'SINTETICA',
  ativa: true,
  filhos,
});
// 4.1.1.1.001 é vetada pela raiz de pessoal; 4.1.1.8.003, só pelas premissas do exercício mais recente.
const CONTAS: readonly NoConta[] = [
  sintetica('4', 'DESPESAS', [
    sintetica('4.1', 'DESPESAS OPERACIONAIS', [
      sintetica('4.1.1', 'DESPESAS DE SERVIÇOS', [
        sintetica('4.1.1.1', 'DESPESAS DE PESSOAL', [analitica('4.1.1.1.001', 'Salários')]),
        sintetica('4.1.1.3', 'DESPESA DE VIAGEM', [analitica('4.1.1.3.001', 'Passagem aérea')]),
        sintetica('4.1.1.5', 'DESPESAS ADMINISTRATIVAS', [analitica('4.1.1.5.005', 'Material de escritório'), analitica('4.1.1.5.028', 'Material de Informática')]),
        sintetica('4.1.1.8', 'OUTROS ENCARGOS', [analitica('4.1.1.8.003', 'Obrigações')]),
      ]),
    ]),
  ]),
];

// Descrições marcadas: o resumo nunca pode trazer texto dos casos.
const CASOS = [
  { descricao: 'Toner para as impressoras do setor (CASO-SECRETO-A)', contaEsperada: '4.1.1.5.028' },
  { descricao: 'Resmas de papel e canetas (CASO-SECRETO-B)', contaEsperada: '4.1.1.5.028' },
  { descricao: 'Bilhetes aéreos para o seminário (CASO-SECRETO-C)', contaEsperada: '4.1.1.3.001' },
];
const RESPOSTA = { contas: [{ conta: '4.1.1.5.028', motivo: 'Material de informática.' }], cc: { cc: '4.4', motivo: 'Suporte.' } };
const falso = criarProvedorIAFalso({ estruturado: RESPOSTA });

const deps = (extra: Partial<DepsAvaliadorSugestaoConta> = {}): Partial<DepsAvaliadorSugestaoConta> => ({
  cliente: app,
  ia: criarServicoIA({ cliente: app, obterProvedor: () => falso }),
  estrutura: estruturaFinanceiraFalsa({ contas: CONTAS }),
  obterPremissasExercicio: custoPessoalFalso([{ ...premissasExemplo(ANO), versao: 1 }]).obterPremissasExercicio,
  casos: CASOS,
  opcoes: { esperar: async () => undefined },
  ...extra,
});
const pedido = (usuarioId: string) => ({ avaliacaoId: '00000000-0000-0000-0000-000000000000', casoUsoCodigo: CASO, usuarioId });
const chamadas = async () =>
  (await migrator.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ia_chamada WHERE caso_uso_codigo = $1`, CASO))[0]!.n;

let seq = 0;
/** Uma pessoa com o perfil GFIN da seed; `sem` tira funcionalidades dela (exceção por usuário). */
async function gfin(sem: string[] = []) {
  const login = `gfin.avaliacao${++seq}`;
  const u = await migrator.usuario.create({ data: { nome: `Fulana Avaliadora ${seq}`, email: `${login}@exemplo.org`, login, loginNormalizado: login, senhaHash: 'x' } });
  await migrator.usuarioPerfil.create({ data: { usuarioId: u.id, perfilId: perfilGfin } });
  for (const f of sem) await migrator.usuarioExcecao.create({ data: { usuarioId: u.id, perfilId: perfilGfin, funcionalidadeCodigo: f } });
  return u.id;
}

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  await executarSeeds(migrator, [seedAdm, seedOrc]);
  app = criarPrisma(banco.urlApp);
  perfilGfin = (await migrator.perfil.findUniqueOrThrow({ where: { codigo: 'GFIN' } })).id;
  await migrator.orcamentoExercicio.create({ data: { ano: ANO } });
  await migrator.$executeRawUnsafe(`UPDATE ia_configuracao SET habilitada = true, teto_mensal_usd = 100, limite_por_minuto = 1000`);
  await migrator.$executeRawUnsafe(`UPDATE ia_caso_uso SET ativo = true, teto_mensal_usd = 10 WHERE codigo = $1`, CASO);
}, 120_000);

beforeEach(() => {
  falso.roteiro.estruturado = RESPOSTA;
  delete falso.roteiro.erro;
  falso.chamadas.length = 0;
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

describe('avaliadorSugestaoConta', () => {
  it('pessoa válida: total e acertos no top-3, um registro em ia_chamada por caso e o resumo só com números', async () => {
    const id = await gfin();
    const antes = await chamadas();
    const r = await criarAvaliadorSugestaoConta(deps())(pedido(id));
    expect(r).toEqual({ total: 3, acertos: 2, resumo: { errosIa: 0, taxa: 2 / 3 } });
    expect(falso.chamadas).toHaveLength(3);
    expect(await chamadas()).toBe(antes + 3);
    expect(JSON.stringify(r)).not.toMatch(/CASO-SECRETO|Toner|Bilhetes|4\.1\.1/);
  });

  it('ADMINISTRADOR semeado (quem pede na /int/ia, #403): devolve o resultado', async () => {
    const perfil = (await migrator.perfil.findUniqueOrThrow({ where: { codigo: 'ADMINISTRADOR' } })).id;
    const login = `admin.avaliacao${++seq}`;
    const u = await migrator.usuario.create({ data: { nome: 'Admin Avaliador', email: `${login}@exemplo.org`, login, loginNormalizado: login, senhaHash: 'x' } });
    await migrator.usuarioPerfil.create({ data: { usuarioId: u.id, perfilId: perfil } });
    expect(await criarAvaliadorSugestaoConta(deps())(pedido(u.id))).toEqual({ total: 3, acertos: 2, resumo: { errosIa: 0, taxa: 2 / 3 } });
    expect(falso.chamadas).toHaveLength(3);
  });

  it('listas do formulário com escopo TOTAL: sem as vetadas (raiz de pessoal e premissas do exercício mais recente), com todos os CCs analíticos', async () => {
    const id = await gfin();
    await criarAvaliadorSugestaoConta(deps({ casos: CASOS.slice(0, 1) }))(pedido(id));
    const m = falso.chamadas.at(-1)!.mensagem;
    for (const linha of ['4.1.1.3.001 – Passagem aérea', '4.1.1.5.005 – Material de escritório', '4.1.1.5.028 – Material de Informática', '4.3.0 –', '4.3.2.10 –', '4.3.2.11 –', '4.4 –']) {
      expect(m).toContain(linha);
    }
    for (const fora of ['4.1.1.1.001', '4.1.1.8.003', '4.3 –', '4.3.2 –']) expect(m).not.toContain(fora);
  });

  it('erro da IA num caso conta no total e em errosIa, nunca como acerto', async () => {
    const id = await gfin();
    falso.roteiro.erro = 'ia.saida_invalida';
    expect(await criarAvaliadorSugestaoConta(deps())(pedido(id))).toEqual({ total: 3, acertos: 0, resumo: { errosIa: 3, taxa: 0 } });
  });

  it('pessoa inativa, bloqueada, sem a permissão do caso ou com CC de escopo: erro de domínio, sem chamar a IA', async () => {
    const inativa = await gfin();
    await migrator.usuario.update({ where: { id: inativa }, data: { ativo: false } });
    const bloqueada = await gfin();
    await migrator.usuario.update({ where: { id: bloqueada }, data: { bloqueado: true } });
    const semPermissao = await gfin([CASOS_IA_ORC.sugestaoConta.funcionalidade]);
    const comEscopo = await gfin();
    const avaliar = criarAvaliadorSugestaoConta(deps());
    const escopo = criarAvaliadorSugestaoConta(deps({ pessoa: { ...FUNCOES_PESSOA_IA, obterEscopo: async () => '4.3' } }));
    const antes = await chamadas();
    for (const [av, id] of [[avaliar, inativa], [avaliar, bloqueada], [avaliar, semPermissao], [escopo, comEscopo], [avaliar, '00000000-0000-0000-0000-000000000009']] as [AvaliadorCasoIA, string][]) {
      const p = av(pedido(id));
      await expect(p).rejects.toBeInstanceOf(ErroDominio);
      await expect(p).rejects.toThrow(MSG_AVALIACAO_SEM_ACESSO);
    }
    expect(falso.chamadas).toHaveLength(0);
    expect(await chamadas()).toBe(antes);
  });

  it('sinal da avaliação abortado: para com ErroIA ia.cancelada, sem contar os casos como erro da IA', async () => {
    const id = await gfin();
    const sinal = AbortSignal.abort();
    const p = criarAvaliadorSugestaoConta(deps())({ ...pedido(id), sinal } as Parameters<AvaliadorCasoIA>[0]);
    await expect(p).rejects.toBeInstanceOf(ErroIA);
    await expect(p).rejects.toMatchObject({ codigo: 'ia.cancelada' });
    expect(falso.chamadas).toHaveLength(0);
  });
});

describe('no trabalhador da fila ia.avaliar (int)', () => {
  async function rodar(usuarioId: string) {
    let tratar: ((dados: unknown) => Promise<void>) | undefined;
    const fila = { registrarTrabalhador: async (nome: string, t: (dados: unknown) => Promise<void>) => void (nome === FILA_AVALIACAO_IA && (tratar = t)) } as unknown as FilaGerenciada;
    await registrarTrabalhadoresInt(fila, { cliente: app, avaliadores: { [CASO]: criarAvaliadorSugestaoConta(deps()) } });
    const [{ id }] = (await migrator.$queryRaw<{ id: string }[]>`INSERT INTO ia_avaliacao (caso_uso_codigo, usuario_id) VALUES (${CASO}, ${usuarioId}::uuid) RETURNING id`) as [{ id: string }];
    await tratar!({ avaliacaoId: id });
    return migrator.iaAvaliacao.findUniqueOrThrow({ where: { id } });
  }

  it('pessoa válida: CONCLUIDA com total, acertos e o resumo só com números', async () => {
    const a = await rodar(await gfin());
    expect(a).toMatchObject({ situacao: 'CONCLUIDA', total: 3, acertos: 2, resumo: { errosIa: 0, taxa: 2 / 3 }, erro: null });
  });

  it('pessoa sem a permissão: FALHOU com a mensagem genérica, sem o texto do erro', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = await rodar(await gfin([CASOS_IA_ORC.sugestaoConta.funcionalidade]));
    erro.mockRestore();
    expect(a.situacao).toBe('FALHOU');
    expect(a.erro).not.toBe(MSG_AVALIACAO_SEM_ACESSO);
    expect(a.erro).toMatch(/A avaliação falhou/);
    expect(falso.chamadas).toHaveLength(0);
  });
});
