import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { totalEncargos, type OpcaoConta, type ParametrosTela } from '../domain/parametros-tela';
import { FormParametros, mensagemCongelado } from './form-parametros';
import { FormSalarioMinimo } from './form-salario-minimo';
import { SeletorAno } from './seletor-ano';

// Telas de parâmetros do exercício e do salário mínimo (plano do P4, Task 9b, Step 1).
// Fora do Next, connection() não tem requisição.
vi.mock('next/server', () => ({ connection: async () => undefined }));
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
    expect(h).toMatch(/>Adicional<\/label><strong> Provisório<\/strong>/);
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
  });
});

describe('SeletorAno e FormSalarioMinimo (SSR)', () => {
  it('o seletor de ano: formulário GET com os exercícios, o atual escolhido', () => {
    const h = renderToString(createElement(SeletorAno, { acao: '/cad/parametros', anos: [2028, 2027], ano: 2027 }));
    expect(h).toMatch(/<form action="\/cad\/parametros" method="get">/);
    expect(h).toContain('<option value="2027" selected="">2027</option>');
    expect(renderToString(createElement(SeletorAno, { acao: '/x', anos: [], ano: null }))).toBe('');
  });

  it('salário mínimo: valor, "ainda não informado" e congelado', () => {
    const base = { ano: 2027, versao: 1, congelado: false, podeAlterar: true, alterar };
    expect(renderToString(createElement(FormSalarioMinimo, { ...base, valor: '1518.00' }))).toContain('value="1518.00"');
    expect(renderToString(createElement(FormSalarioMinimo, { ...base, valor: null }))).toContain('Ainda não informado');
    const congelado = renderToString(createElement(FormSalarioMinimo, { ...base, valor: '1518.00', congelado: true }));
    expect(congelado).toContain('<fieldset disabled="">');
    expect(congelado).not.toContain('Salvar');
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

  it('cada página exige o consultar da sua funcionalidade', async () => {
    const { default: Parametros } = await import('../../../app/(sistema)/cad/parametros/page');
    const { default: Smn } = await import('../../../app/(sistema)/cad/salario-minimo/page');
    contexto = ctx(['cad.salario_minimo', 'consultar']);
    expect(await digest(Parametros({ searchParams }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    contexto = ctx(['cad.parametros', 'consultar']);
    expect(await digest(Smn({ searchParams }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
  });
});
