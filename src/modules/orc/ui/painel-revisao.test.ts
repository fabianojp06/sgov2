import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RevisaoTela } from '../domain/revisor-regras';
import { ConteudoRevisao, ItemAchado, resumoRevisao } from './painel-revisao';

// Painel do revisor antes do envio (US-064): as partes puras, sem DOM.
const html = (revisao: RevisaoTela | null) => renderToStaticMarkup(createElement(ConteudoRevisao, { revisao }));
const concluida = (extra: Partial<RevisaoTela> = {}): RevisaoTela => ({
  situacao: 'CONCLUIDA',
  achados: [],
  avisos: [],
  desatualizada: false,
  concluidaEm: new Date('2026-11-11T15:00:00Z'),
  ...extra,
});

describe('painel do revisor', () => {
  it('sem revisão, em andamento e parada', () => {
    expect(html(null)).toBe('<p>Nenhuma revisão pedida para este exercício.</p>');
    // Em andamento: só a região viva do painel fala (resumoRevisao).
    expect(html(concluida({ situacao: 'PENDENTE', concluidaEm: null }))).toBe('');
    const parada = html(concluida({ situacao: 'FALHOU', concluidaEm: null, avisos: ['A revisão não terminou. Peça de novo.'] }));
    expect(parada).toContain('A revisão não terminou. Peça de novo.');
    expect(parada).not.toContain('Nenhum achado');
  });

  it('o achado da IA leva o selo; o da regra, não; os links levam à linha', () => {
    const ia = renderToStaticMarkup(
      createElement(ItemAchado, { achado: { origem: 'IA', tipo: 'JUSTIFICATIVA_FRACA', texto: 'Falta a quantidade.', links: [{ rotulo: 'Pacote 4.3.0 · 4.1.1.5.005', href: '/orc/pacotes?ano=2027&cc=4.3.0&editar=x', tipo: 'pacote' }] } }),
    );
    expect(ia).toBe(
      '<li><strong>Justificativa fraca</strong> <span class="selo-ia">Gerado com IA – revisar</span>: Falta a quantidade.<ul><li><a href="/orc/pacotes?ano=2027&amp;cc=4.3.0&amp;editar=x">Pacote 4.3.0 · 4.1.1.5.005</a></li></ul></li>',
    );
    const regra = renderToStaticMarkup(createElement(ItemAchado, { achado: { origem: 'REGRA', tipo: 'DUPLICADO', texto: '2 pacotes iguais.', links: [] } }));
    expect(regra).toBe('<li><strong>Pacotes duplicados</strong>: 2 pacotes iguais.</li>');
  });

  it('concluída: data, avisos, achados e o aviso de desatualizada', () => {
    const h = html(concluida({ desatualizada: true, avisos: ['A parte da IA está desligada; estes são só os achados automáticos.'] }));
    expect(h).toContain('Revisão concluída em 11/11/2026, 12:00.');
    expect(h).toContain('<p role="note">O orçamento mudou depois desta revisão. Revise de novo.</p>');
    expect(h).toContain('A parte da IA está desligada');
    expect(h).toContain('<p>Nenhum achado.</p>');
  });

  it('a região viva resume o estado: em andamento, concluída com N achados, falhou', () => {
    expect(resumoRevisao(null)).toBe('');
    expect(resumoRevisao(concluida({ situacao: 'PENDENTE', concluidaEm: null }))).toBe('Revisão em andamento…');
    expect(resumoRevisao(concluida({ situacao: 'FALHOU', concluidaEm: null }))).toBe('A revisão falhou.');
    expect(resumoRevisao(concluida())).toBe('Revisão concluída com 0 achados.');
    expect(resumoRevisao(concluida({ achados: [{ origem: 'REGRA', tipo: 'DUPLICADO', texto: 'x', links: [] }] }))).toBe('Revisão concluída com 1 achado.');
  });
});
