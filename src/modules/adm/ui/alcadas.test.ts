import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormAlcada, type PropsFormAlcada } from './form-alcada';
import { ListaAlcadas, situacaoAlcada } from './lista-alcadas';

// Telas das alçadas (US-042, §11.4).
const acao = async () => ({ ok: true as const, valor: undefined });
const usuarios = [
  { id: '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c', nome: 'Ana Maria' },
  { id: '1c2f7a2b-6d4a-4d3c-8f1b-4e7a2a3b5c6d', nome: 'Bruno Lima' },
];
const fluxos = [
  { codigo: 'WA01', rotulo: 'Oficialização de proposta' },
  { codigo: 'WA02', rotulo: 'Logística de viagens' },
];
const form = (p: Partial<PropsFormAlcada> = {}) => renderToString(createElement(FormAlcada, { fluxos, usuarios, salvar: acao, ...p }));
const alcada = { id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', fluxo: 'WA01', rotuloFluxo: 'Oficialização de proposta', titularId: usuarios[0]!.id, substitutoId: usuarios[1]!.id, versao: 3 };

describe('FormAlcada', () => {
  it('cadastro: seleção de fluxo, titular e substituto entre os usuários ativos; sem Excluir', () => {
    const h = form();
    expect(h).toContain('name="fluxo"');
    expect(h).toContain('WA02 – Logística de viagens');
    expect(h).toContain('name="titularId"');
    expect(h).toContain('name="substitutoId"');
    expect(h).toContain('>Bruno Lima<');
    expect(h).not.toContain('Excluir');
  });

  it('alteração: fluxo fixo, id e versão escondidos; Excluir só com a ação', () => {
    const h = form({ alcada, excluir: acao });
    expect(h).not.toContain('name="fluxo"');
    expect(h).toContain('Fluxo: WA01 – Oficialização de proposta');
    expect(h).toMatch(/<input type="hidden" name="versao" value="3"/);
    expect(h).toContain('Excluir');
    expect(form({ alcada })).not.toContain('Excluir');
  });
});

describe('ListaAlcadas', () => {
  const linha = (ativa: boolean) => ({
    id: ativa ? 'a1' : 'a2',
    fluxo: 'WA05',
    rotuloFluxo: 'Alocação de pessoal',
    titular: { nome: 'Ana Maria', ativo: false },
    substituto: { nome: 'Bruno Lima', ativo: true },
    ativa,
    inativadaEm: ativa ? null : new Date('2026-11-04T15:00:00Z'),
  });

  it('colunas, aprovador inativo identificado e link só na ativa para quem altera', () => {
    const h = renderToString(createElement(ListaAlcadas, { alcadas: [linha(true), linha(false)], podeIncluir: true, podeAlterar: true }));
    for (const t of ['Fluxo', 'Titular', 'Substituto', 'Situação', 'WA05 – Alocação de pessoal', 'Ana Maria (inativo)', 'Novo']) expect(h).toContain(t);
    expect(h).toContain('href="/adm/alcadas/a1"');
    expect(h).not.toContain('href="/adm/alcadas/a2"');
    expect(renderToString(createElement(ListaAlcadas, { alcadas: [linha(true)], podeIncluir: false, podeAlterar: false }))).not.toContain('href="/adm/alcadas/a1"');
  });

  it('situação: Ativa ou Inativa desde a data (horário de Brasília); aviso só por código conhecido', () => {
    expect(situacaoAlcada({ ativa: true, inativadaEm: null })).toBe('Ativa');
    expect(situacaoAlcada({ ativa: false, inativadaEm: new Date('2026-11-04T15:00:00Z') })).toBe('Inativa desde 04/11/2026');
    const comAviso = (aviso: string) => renderToString(createElement(ListaAlcadas, { alcadas: [], podeIncluir: false, podeAlterar: false, aviso }));
    expect(comAviso('cadastrada')).toContain('Alçada cadastrada com sucesso');
    expect(comAviso('<script>')).not.toContain('role="status"');
  });
});
