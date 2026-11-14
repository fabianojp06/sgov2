import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { Dinheiro } from '@/shared/kernel';
import type { BlocoViagens, FiltrosViagens, ViagemTela } from '../application/viagens';
import { MENSAGENS_ORC as M } from '../domain/mensagens';
import { custoDaViagem, indicadores } from '../domain/viagem';

// Página das viagens da proposta (US-071; plano do P21, Task 2, Step 1).
vi.mock('next/server', () => ({ connection: async () => undefined }));
const P_META = '00000000-0000-4000-8000-0000000000b1';
const P_APROVACAO = '00000000-0000-4000-8000-0000000000b2';
const P_SEM_TETO = '00000000-0000-4000-8000-0000000000b3';
const M1 = '00000000-0000-4000-8000-0000000000c1';
const V1 = '00000000-0000-4000-8000-0000000000d1';
const V2 = '00000000-0000-4000-8000-0000000000d2';
const T1 = '00000000-0000-4000-8000-0000000000e1';
const caso = vi.hoisted(() => ({
  filtros: [] as unknown[],
  opcoes: 0,
  validadores: { titular: 'Gestor (gfin)', substituto: 'Diretoria' } as { titular: string; substituto: string } | { motivo: string },
}));
const P_OFICIAL = '00000000-0000-4000-8000-0000000000b4';

const cabecalho = {
  propostaId: P_META,
  numero: 'TP-2027/001',
  objeto: 'Programa de capacitação',
  tipo: 'TERMO_PARCERIA' as const,
  categoria: 'META' as const,
  versaoNumero: 2,
  situacao: 'RASCUNHO' as const,
  editavel: true,
  versaoCapa: 7,
  vigencia: { inicio: '2027-01', fim: '2027-12' },
  metas: [{ id: M1, numero: 'M1', nome: 'Oficinas' }],
};
const viagem = (extra: Partial<Omit<ViagemTela, 'custo'>>): ViagemTela => {
  const base = {
    id: V1,
    metaId: M1,
    localidade: 'Brasil',
    pessoas: 2,
    dias: 3,
    valorPassagem: Dinheiro.de('1000.00'),
    valorDiaria: Dinheiro.de('250.00'),
    valorTransporte: Dinheiro.de('0.00'),
    contaPassagem: '4.2.1.1.001',
    contaDiaria: '4.2.1.1.002',
    contaTransporte: null,
    versao: 0,
    ...extra,
  };
  return { ...base, custo: custoDaViagem(base) };
};
const viagens = [
  viagem({}),
  viagem({
    id: V2,
    localidade: 'Chile',
    pessoas: 1,
    dias: 1,
    valorPassagem: Dinheiro.de('5000.00'),
    valorDiaria: Dinheiro.de('100.00'),
  }),
];
const bloco = (extra: Partial<BlocoViagens>): BlocoViagens => ({
  ...cabecalho,
  tetos: [
    {
      id: T1,
      contaSintetica: '4.2.1',
      descricao: 'VIAGENS NACIONAIS',
      valor: Dinheiro.de('10000.00'),
      consumido: Dinheiro.de('8600.00'),
      saldo: Dinheiro.de('1400.00'),
      versao: 1,
    },
  ],
  grupos: [{ metaId: M1, metaNumero: 'M1', metaNome: 'Oficinas', viagens }],
  indicadores: indicadores(viagens),
  ...extra,
});

vi.mock('@/modules/orc', async (original) => {
  const { exigir } = await import('@/shared/authz');
  return {
    ...(await original<typeof import('@/modules/orc')>()),
    listarViagens: async (ctx: ContextoRequisicao, filtros: FiltrosViagens) => {
      exigir(ctx, 'orc.viagens', 'consultar');
      caso.filtros.push(filtros);
      return [
        bloco({}),
        bloco({
          propostaId: P_APROVACAO,
          numero: 'TP-2027/002',
          situacao: 'EM_APROVACAO',
          editavel: false,
          grupos: [],
          indicadores: indicadores([]),
        }),
        bloco({
          propostaId: P_OFICIAL,
          numero: 'TP-2027/004',
          situacao: 'OFICIALIZADO',
          editavel: false,
          validavel: true,
          grupos: [{ metaId: M1, metaNumero: 'M1', metaNome: 'Oficinas', viagens: [viagem({ validacao: 'REJEITADO' }), viagem({ id: V2, localidade: 'Chile', validacao: 'VALIDADO' })] }],
        }),
        bloco({
          propostaId: P_SEM_TETO,
          numero: 'TP-2027/003',
          tetos: [],
          grupos: [],
          indicadores: indicadores([]),
        }),
      ];
    },
    validadoresDasViagens: async (ctx: ContextoRequisicao) => {
      exigir(ctx, 'orc.viagens', 'executar');
      return caso.validadores;
    },
    opcoesViagem: async () => {
      caso.opcoes++;
      return {
        analiticas: [
          { classificacao: '4.2.1.1.001', descricao: 'Passagens aéreas' },
          { classificacao: '4.2.1.1.002', descricao: 'Diárias' },
        ],
        sinteticas: [{ classificacao: '4.2.1', descricao: 'VIAGENS NACIONAIS' }],
        descricoes: new Map(),
      };
    },
  };
});

const { default: Viagens } = await import('../../../app/(sistema)/orc/viagens/page');

const ctx = (permissoes: string[]): ContextoRequisicao => ({
  usuarioId: 'u1',
  usuarioRotulo: 'u',
  sessaoUid: 's1',
  ip: null,
  permissoes: new Set(permissoes),
});
const LANCA = ['consultar', 'incluir', 'alterar', 'excluir'].map((a) => `orc.viagens:${a}`);
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];

beforeEach(() => {
  caso.filtros = [];
  caso.opcoes = 0;
  negacoes = [];
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e);
  });
});

const digest = (p: Promise<unknown>) =>
  p.then(
    () => 'sem erro',
    (e: { digest?: string }) => e.digest ?? String(e),
  );
const html = async (busca: Record<string, string> = {}) => renderToStaticMarkup(await Viagens({ searchParams: Promise.resolve(busca) }));
const trecho = (h: string, id: string) => {
  const inicio = h.indexOf(`<section aria-labelledby="viagens-${id}"`);
  const fim = h.indexOf('<section aria-labelledby="viagens-', inicio + 1);
  return h.slice(inicio, fim === -1 ? undefined : fim);
};

describe('página das viagens da proposta', () => {
  it('quem lança: Camada 1, cartões, composição, ranking, grade por meta e as ações', async () => {
    contexto = ctx(LANCA);
    const b = trecho(await html(), P_META);
    expect(b).toContain('<th scope="row">4.2.1 – VIAGENS NACIONAIS</th><td>10.000,00</td><td>8.600,00</td><td>1.400,00</td>');
    expect(b).toContain(`<a href="/orc/viagens?editarTeto=${T1}">Editar o teto da conta 4.2.1</a>`);
    expect(b).toContain('<dt>Nº de viagens</dt><dd>2</dd><dt>Custo total estimado</dt><dd>R$ 8.600,00</dd><dt>Custo médio por viagem</dt><dd>R$ 4.300,00</dd>');
    expect(b).toContain('<dt>Total de pessoas-viagem</dt><dd>3</dd>');
    expect(b).toContain('<dt>Total geral</dt><dd>R$ 8.600,00</dd>');
    expect(b.indexOf('<th scope="row">Chile</th><td>5.100,00</td>')).toBeLessThan(b.indexOf('<th scope="row">Brasil</th><td>3.500,00</td>'));
    expect(b).toContain('width:100%');
    expect(b).toContain(`<caption id="viagens-${P_META}-${M1}-caption">Meta M1 – Oficinas, custos em R$</caption>`);
    expect(b).toContain('<th scope="row">Brasil</th><td>2</td><td>3</td><td>1.000,00</td><td>250,00</td><td>0,00</td><td>3.500,00</td>');
    expect(b).toContain(`<a href="/orc/viagens?editar=${V1}">Editar a viagem para Brasil</a>`);
    expect(b).toContain(`<a href="/orc/viagens?copiar=${V1}">Copiar a viagem para Brasil</a>`);
    expect(b).toContain('Excluir a viagem para Chile');
    expect(b).toContain(`<a href="/orc/viagens?nova=${P_META}">Nova viagem na proposta TP-2027/001</a>`);
  });

  it('quem só consulta não vê ações; Em Aprovação sem "Nova"; sem teto, a nota e custo médio "—"', async () => {
    contexto = ctx(['orc.viagens:consultar']);
    const b = trecho(await html(), P_META);
    expect(b).toContain('R$ 8.600,00');
    expect(b).not.toContain('Editar');
    expect(b).not.toContain('Copiar');
    expect(b).not.toContain('Novo teto');
    contexto = ctx(LANCA);
    const h = await html();
    expect(trecho(h, P_APROVACAO)).toContain('Nenhuma viagem nesta versão.');
    expect(trecho(h, P_APROVACAO)).not.toContain('Nova viagem');
    expect(trecho(h, P_SEM_TETO)).toContain('Cadastre o teto de uma conta sintética antes de lançar viagens.');
    expect(trecho(h, P_SEM_TETO)).toContain('<dt>Custo médio por viagem</dt><dd>—</dd>');
    expect(trecho(h, P_SEM_TETO)).toContain(`<a href="/orc/viagens?novoTeto=${P_SEM_TETO}">Novo teto de viagens na proposta TP-2027/003</a>`);
  });

  it('?copiar= abre a inclusão preenchida; ?editar= com a meta e as contas só leitura', async () => {
    contexto = ctx(LANCA);
    const c = await html({ copiar: V1, proposta: 'x' });
    expect(caso.filtros).toEqual([{}]);
    expect(caso.opcoes).toBe(1);
    expect(c).toContain('Nova viagem a partir da viagem para Brasil</h2>');
    expect(c).toContain(`<input type="hidden" name="propostaId" value="${P_META}"/>`);
    expect(c).not.toContain(`name="id" value="${V1}"`);
    expect(c).toMatch(/<select id="copiar-viagem-meta" name="metaId"/);
    expect(c).toContain('value="1.000,00"');
    expect(c).toContain('<option value="4.2.1.1.002" selected="">4.2.1.1.002 – Diárias</option>');
    expect(c).toContain('Incluir viagem');
    const e = await html({ editar: V1 });
    expect(e).toContain('Alterar a viagem para Brasil</h2>');
    expect(e).toContain('<input id="alterar-viagem-meta" readOnly="" value="M1 – Oficinas"/>');
    expect(e).toContain('<input id="alterar-viagem-contaPassagem" readOnly="" value="4.2.1.1.001 – Passagens aéreas"/>');
    expect(e).not.toContain('name="metaId"');
    expect(e).not.toContain('name="contaPassagem"');
    expect(e).toContain('name="contaTransporte"');
  });

  it('?novoTeto= e ?editarTeto=: o formulário do teto', async () => {
    contexto = ctx(LANCA);
    const n = await html({ novoTeto: P_SEM_TETO });
    expect(n).toContain('Novo teto de viagens na proposta TP-2027/003</h2>');
    expect(n).toContain('<option value="4.2.1">4.2.1 – VIAGENS NACIONAIS</option>');
    const e = await html({ editarTeto: T1 });
    expect(e).toContain('<input id="alterar-teto-conta" readOnly="" value="4.2.1 – VIAGENS NACIONAIS"/>');
    expect(e).toContain('value="10.000,00"');
    expect(e).not.toContain('name="contaSintetica"');
    expect(await html({ nova: P_SEM_TETO })).toContain(`<p role="status">${M.PROPOSTA_INEXISTENTE}</p>`);
  });

  it('avisos e filtros; sem permissão: 404', async () => {
    contexto = ctx(LANCA);
    expect(await html({ aviso: 'incluida', l: 'Chile' })).toContain(`<p role="status">${M.VIAGEM_INCLUIDA('Chile')}</p>`);
    expect(await html({ aviso: 'teto-alterado', c: '4.2.1' })).toContain(`<p role="status">${M.TETO_ALTERADO('4.2.1')}</p>`);
    expect(await html({ aviso: 'teto-alterado', c: '<b>' })).not.toContain('alterado.');
    await html({
      tipo: 'CONTRATO',
      proposta: 'capac',
      meta: 'ofic',
      localidade: 'chi',
    });
    expect(caso.filtros.at(-1)).toEqual({
      tipo: 'CONTRATO',
      proposta: 'capac',
      meta: 'ofic',
      localidade: 'chi',
    });
    expect(await html()).toContain('<label for="viagens-filtro-localidade">Localidade</label>');
    contexto = ctx(['orc.propostas:consultar']);
    expect(await digest(html())).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(negacoes).toHaveLength(1);
  });
});

describe('validação das viagens (US-081, WA02)', () => {
  it('o Operador vê o botão com os validadores; sem aprovador, o motivo; sem executar, nada; os selos na versão Oficializada', async () => {
    contexto = ctx([...LANCA, 'orc.viagens:executar']);
    const h = trecho(await html(), P_OFICIAL);
    expect(h).toContain('Solicitar a validação das viagens da proposta TP-2027/004');
    expect(h).toContain('Validação (WA02)');
    expect(h).toContain('Rejeitada');
    expect(h).toContain('Validada');
    expect(trecho(await html(), P_META)).not.toContain('Validação (WA02)');
    expect(trecho(await html(), P_META)).not.toContain('Solicitar a validação');
    caso.validadores = { motivo: 'Operação indisponível: Não há validador homologador ativo cadastrado para este fluxo.' };
    expect(trecho(await html(), P_OFICIAL)).toContain('Não há validador homologador ativo');
    caso.validadores = { titular: 'Gestor (gfin)', substituto: 'Diretoria' };
    contexto = ctx(LANCA);
    const sem = trecho(await html(), P_OFICIAL);
    expect(sem).not.toContain('Solicitar a validação');
    expect(sem).toContain('Validada');
  });

  it('o aviso depois do pedido', async () => {
    contexto = ctx([...LANCA, 'orc.viagens:executar']);
    expect(await html({ aviso: 'validacao', n: 'TP-2027/004' })).toContain(M.VIAGENS_SOLICITADA('TP-2027/004'));
  });
});

