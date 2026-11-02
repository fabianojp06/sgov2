import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { totalEncargos, type OpcaoConta, type ParametrosTela } from '../domain/parametros-tela';
import { FormParametros, MSG_SO_CONSULTA, mensagemCongelado } from './form-parametros';
import { campoExibido, depoisDeSalvar, diasUteisDoTexto } from './form-parametros-logica';
import { FormSalarioMinimo } from './form-salario-minimo';
import { SeletorAno } from './seletor-ano';

// Telas de parâmetros do exercício e do salário mínimo (plano do P4, Task 9b, Step 1).
// Fora do Next, connection() não tem requisição.
vi.mock('next/server', () => ({ connection: async () => undefined }));
const telaFalsa = vi.hoisted(() => ({ provisorio: true }));
vi.mock('@/modules/cad', async (original) => {
  const real = await original<typeof import('@/modules/cad')>();
  return {
    ...real,
    obterTelaParametros: async () => ({ anos: [2027], ano: 2027, parametros: { ...tela, provisorio: telaFalsa.provisorio }, contas }),
    obterTelaSalarioMinimo: async () => ({ anos: [2027], ano: 2027, dados: { ano: 2027, versao: 1, congelado: false, valor: '1518.00' } }),
  };
});
const tela: ParametrosTela = {
  ano: 2027,
  versao: 3,
  congelado: false,
  provisorio: true,
  provisorios: ['adicional', 'encargo.obrigacoes'],
  reajuste: '5.0000',
  mesDataBase: 5,
  ipca: '4.0000',
  diasUteisMes: 22,
  semaforo: { verdeAte: '70.0000', amareloAte: '85.0000', laranjaAte: '95.0000' },
  encargos: [
    { componente: 'encargo.inss', nome: 'INSS', percentual: '38.0000', conta: '4.1.1.2.001' },
    { componente: 'encargo.fgts', nome: 'FGTS', percentual: '8.0000', conta: '4.1.1.2.005' },
    { componente: 'encargo.pis', nome: 'PIS/PASEP', percentual: '1.0000', conta: '4.1.1.2.008' },
    { componente: 'encargo.obrigacoes', nome: 'Obrigações Trabalhistas', percentual: '3.8000', conta: '4.1.1.8.003' },
    { componente: 'encargo.riscos', nome: 'Riscos Trabalhistas', percentual: '0.2000', conta: '4.1.1.8.004' },
  ],
  contas: { salario: '4.1.1.1.001', adicional: '4.1.1.1.025', ferias: '4.1.1.1.003', decimo_terceiro: '4.1.1.1.999' },
};
const contas: OpcaoConta[] = [
  { classificacao: '4.1.1.1.001', descricao: 'Salários' },
  { classificacao: '4.1.1.1.003', descricao: 'Férias' },
  { classificacao: '4.1.1.1.025', descricao: 'Adicionais' },
  { classificacao: '4.1.1.2.001', descricao: 'INSS' },
];
const alterar = async () => ({ ok: true as const, valor: { versao: 4 } });
const html = (extra: Partial<Parameters<typeof FormParametros>[0]> = {}) =>
  renderToString(createElement(FormParametros, { tela, contas, podeAlterar: true, alterar, ...extra }));

describe('totalEncargos', () => {
  it('soma em pontos, com vírgula ou ponto; algum fora do formato → null', () => {
    expect(totalEncargos(['38', '8', '1', '3,8', '0.2'])).toBe('51,00%');
    expect(totalEncargos(['37,5', '0.25'])).toBe('37,75%');
    expect(totalEncargos(['38', 'abc'])).toBeNull();
  });
});

describe('lógica dos formulários', () => {
  it('depois de salvar, a versão nova fica para a próxima gravação; com erro, a anterior', () => {
    const inicio = { versao: 3, erros: [], salvo: false };
    const depois = depoisDeSalvar(inicio, { ok: true, valor: { versao: 4 } });
    expect(depois).toEqual({ versao: 4, erros: [], salvo: true });
    expect(depoisDeSalvar(depois, { ok: true, valor: { versao: 5 } }).versao).toBe(5);
    const erro = [{ campo: '_', mensagem: 'Este registro foi alterado por outro usuário. Recarregue a tela.' }];
    expect(depoisDeSalvar(depois, { ok: false, erros: erro })).toEqual({ versao: 4, erros: erro, salvo: false });
  });

  it('campos mostrados ao lado de controles; o resto vai para o resumo', () => {
    for (const c of ['reajuste', 'mesDataBase', 'semaforo', 'semaforo.verdeAte', 'encargos', 'encargos.3.percentual', 'contas.ferias']) expect(campoExibido(c)).toBe(true);
    for (const c of ['_', 'encargos.0.componente', 'contas.outro', 'ano']) expect(campoExibido(c)).toBe(false);
  });

  it('dias úteis: o texto é guardado; fora do formato vai 0, que o domínio recusa', () => {
    expect(diasUteisDoTexto(' 21 ')).toBe(21);
    expect(diasUteisDoTexto('')).toBe(0);
    expect(diasUteisDoTexto('2a')).toBe(0);
  });
});

describe('FormParametros (SSR)', () => {
  it('o bloco de encargos com o total e as contas entre as analíticas', () => {
    const h = html();
    expect(h).toMatch(/Total dos encargos<\/th><td>51,00%<\/td>/);
    expect(h).toContain('<option value="4.1.1.1.001">4.1.1.1.001 — Salários</option>');
    expect(h).toContain('Contas por componente');
    expect(h).toMatch(/<button type="submit">Salvar<\/button>/);
  });

  it('conta gravada que não é mais analítica ativa continua visível, marcada', () => {
    expect(html()).toContain('<option value="4.1.1.1.999" selected="">4.1.1.1.999 (não é mais analítica ativa)</option>');
  });

  it('o selo "Provisório" nos componentes que ainda têm o padrão provisório', () => {
    const h = html();
    expect(h).toMatch(/Obrigações Trabalhistas<strong> Provisório<\/strong>/);
    // Dentro do rótulo (lido junto com o campo) e no aria-label do percentual.
    expect(h).toMatch(/>Adicional<strong> Provisório<\/strong><\/label>/);
    expect(h).toContain('aria-label="Percentual de Obrigações Trabalhistas (provisório)"');
    expect(h).not.toMatch(/INSS<strong> Provisório/);
  });

  it('ano congelado: todos os campos desabilitados, com a mensagem, e sem Salvar', () => {
    const h = html({ tela: { ...tela, congelado: true } });
    expect(h).toContain(mensagemCongelado(2027));
    expect(h.match(/<fieldset disabled="">/g)).toHaveLength(4);
    expect(h).not.toContain('Salvar');
  });

  it('sem a permissão de alterar: só leitura', () => {
    const h = html({ podeAlterar: false });
    expect(h.match(/<fieldset disabled="">/g)).toHaveLength(4);
    expect(h).not.toContain('Salvar');
    expect(h).not.toContain(mensagemCongelado(2027));
    expect(h).toContain(MSG_SO_CONSULTA);
  });
});

describe('SeletorAno e FormSalarioMinimo (SSR)', () => {
  it('o seletor de ano: formulário GET com os exercícios, o atual escolhido', () => {
    const h = renderToString(createElement(SeletorAno, { acao: '/cad/parametros', anos: [2028, 2027], ano: 2027 }));
    expect(h).toMatch(/<form action="\/cad\/parametros" method="get">/);
    expect(h).toContain('<option value="2027" selected="">2027</option>');
    expect(renderToString(createElement(SeletorAno, { acao: '/x', anos: [], ano: null }))).toBe('');
    // O ano pedido sem parâmetros também aparece, escolhido.
    expect(renderToString(createElement(SeletorAno, { acao: '/x', anos: [2027], ano: 2031 }))).toContain('<option value="2031" selected="">2031</option>');
  });

  it('salário mínimo: valor, "ainda não informado" e congelado', () => {
    const base = { ano: 2027, versao: 1, congelado: false, podeAlterar: true, alterar };
    expect(renderToString(createElement(FormSalarioMinimo, { ...base, valor: '1518.00' }))).toContain('value="1518.00"');
    expect(renderToString(createElement(FormSalarioMinimo, { ...base, valor: null }))).toContain('Ainda não informado');
    const congelado = renderToString(createElement(FormSalarioMinimo, { ...base, valor: '1518.00', congelado: true }));
    expect(congelado).toContain('<fieldset disabled="">');
    expect(congelado).not.toContain('Salvar');
    const consulta = renderToString(createElement(FormSalarioMinimo, { ...base, valor: '1518.00', podeAlterar: false }));
    expect(consulta).toContain(MSG_SO_CONSULTA);
    expect(consulta).not.toContain('Salvar');
  });
});

describe('páginas', () => {
  let contexto: ContextoRequisicao;
  const ctx = (...p: [string, string][]): ContextoRequisicao => ({
    usuarioId: '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c',
    usuarioRotulo: 'u',
    sessaoUid: 's',
    ip: null,
    permissoes: new Set(p.map(([f, a]) => `${f}:${a}`)),
  });
  const digest = (p: Promise<unknown>) => p.then(() => 'sem erro', (e: { digest?: string }) => e.digest ?? String(e));
  const searchParams = Promise.resolve({});
  beforeEach(() => {
    limparJanelaNegacoes();
    configurarProvedorContexto({ obter: async () => contexto });
    configurarAuditorNegacao(async () => undefined);
  });

  const html = async (p: Promise<unknown>) => renderToString((await p) as Parameters<typeof renderToString>[0]);

  it('"Salvar" só com a permissão de alterar; o selo "Provisório" do exercício no título', async () => {
    const { default: Parametros } = await import('../../../app/(sistema)/cad/parametros/page');
    const { default: Smn } = await import('../../../app/(sistema)/cad/salario-minimo/page');
    contexto = ctx(['cad.parametros', 'consultar']);
    const consulta = await html(Parametros({ searchParams }));
    expect(consulta).not.toContain('Salvar');
    expect(consulta).toMatch(/<h1>Parâmetros do exercício <!-- -->2027<strong> Provisório<\/strong><\/h1>/);
    contexto = ctx(['cad.parametros', 'consultar'], ['cad.parametros', 'alterar']);
    expect(await html(Parametros({ searchParams }))).toContain('>Salvar</button>');
    telaFalsa.provisorio = false;
    expect(await html(Parametros({ searchParams }))).not.toContain('<strong> Provisório</strong></h1>');
    contexto = ctx(['cad.salario_minimo', 'consultar']);
    expect(await html(Smn({ searchParams }))).not.toContain('Salvar');
    contexto = ctx(['cad.salario_minimo', 'consultar'], ['cad.salario_minimo', 'alterar']);
    expect(await html(Smn({ searchParams }))).toContain('>Salvar</button>');
  });

  it('cada página exige o consultar da sua funcionalidade', async () => {
    const { default: Parametros } = await import('../../../app/(sistema)/cad/parametros/page');
    const { default: Smn } = await import('../../../app/(sistema)/cad/salario-minimo/page');
    contexto = ctx(['cad.salario_minimo', 'consultar']);
    expect(await digest(Parametros({ searchParams }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    contexto = ctx(['cad.parametros', 'consultar']);
    expect(await digest(Smn({ searchParams }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
  });
});
