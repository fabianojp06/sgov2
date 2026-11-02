import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ImportarEstrutura, ListaLinhas } from './importar-estrutura';
import {
  acompanharCarga,
  INTERVALO_CONSULTA_MS,
  resumir,
  separarErros,
  textoSituacao,
  type Acompanhamento,
  type EstadoCargaTela,
  type Resposta,
} from './importar-estrutura-logica';

// Tela de importação do plano de contas (plano do P4, Task 7a, Step 1).
const estado = (situacao: EstadoCargaTela['situacao'], extra: Partial<EstadoCargaTela> = {}): EstadoCargaTela => ({
  cargaId: '6f1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d',
  situacao,
  linhas: 174,
  incluidas: null,
  alteradas: null,
  inativadas: null,
  inalteradas: null,
  avisos: [],
  erros: [],
  erro: null,
  ...extra,
});

describe('separarErros', () => {
  it('arquivo, por linha (com e sem coluna) e gerais', () => {
    expect(
      separarErros([
        { campo: 'arquivo', mensagem: 'O arquivo deve ser .xlsx.' },
        { campo: 'linhas.12.Classificação', mensagem: 'Classificação repetida.' },
        { campo: 'linhas.3', mensagem: 'Linha sem dados.' },
        { campo: '_', mensagem: 'Sessão expirada.' },
      ]),
    ).toEqual({
      arquivo: ['O arquivo deve ser .xlsx.'],
      linhas: [
        { linha: 12, coluna: 'Classificação', mensagem: 'Classificação repetida.' },
        { linha: 3, mensagem: 'Linha sem dados.' },
      ],
      gerais: ['Sessão expirada.'],
    });
  });
});

describe('resumir', () => {
  it('até 200, com o total', () => {
    const r = resumir(Array.from({ length: 250 }, (_, i) => i));
    expect(r.mostrados).toHaveLength(200);
    expect(r.mostrados[199]).toBe(199);
    expect(r.total).toBe(250);
    expect(resumir([1, 2]).mostrados).toEqual([1, 2]);
  });
});

describe('textoSituacao', () => {
  it('mensagem final da CONCLUIDA', () => {
    expect(textoSituacao(estado('CONCLUIDA', { incluidas: 170, alteradas: 2, inativadas: 1, inalteradas: 1 }))).toBe(
      'Plano de contas importado: 170 incluídas, 2 alteradas, 1 inativadas, 1 sem alteração.',
    );
    expect(textoSituacao(estado('FALHOU'))).toMatch(/falhou.*Nada foi gravado/);
    expect(textoSituacao(estado('PROCESSANDO'))).toBe('Importando 174 linhas…');
  });
});

describe('acompanharCarga', () => {
  const seguir = async (respostas: Resposta<EstadoCargaTela | null>[], extra: { maxConsultas?: number; cancelado?: () => boolean } = {}) => {
    const consultar = vi.fn(async () => respostas.shift() ?? { ok: true as const, valor: estado('PROCESSANDO') });
    const esperar = vi.fn(async () => {});
    const eventos: Acompanhamento[] = [];
    await acompanharCarga({ cargaId: 'x', consultar, esperar, aoAtualizar: (a) => eventos.push(a), ...extra });
    return { consultar, esperar, eventos };
  };

  it('consulta na hora e a cada 2 s até CONCLUIDA', async () => {
    const r = await seguir([
      { ok: true, valor: estado('PENDENTE') },
      { ok: true, valor: estado('PROCESSANDO') },
      { ok: true, valor: estado('CONCLUIDA') },
    ]);
    expect(r.consultar).toHaveBeenCalledTimes(3);
    expect(r.esperar.mock.calls).toEqual([[INTERVALO_CONSULTA_MS], [INTERVALO_CONSULTA_MS]]);
    expect(r.eventos.map((e) => (e.tipo === 'estado' ? e.estado.situacao : e.tipo))).toEqual(['PENDENTE', 'PROCESSANDO', 'CONCLUIDA']);
  });

  it('para em FALHOU', async () => {
    const r = await seguir([{ ok: true, valor: estado('FALHOU', { erro: 'A carga diverge do plano de contas atual.' }) }]);
    expect(r.consultar).toHaveBeenCalledTimes(1);
    expect(r.esperar).not.toHaveBeenCalled();
  });

  it('lote sumido ou resposta de erro encerram com a mensagem', async () => {
    expect((await seguir([{ ok: true, valor: null }])).eventos).toEqual([{ tipo: 'erro', mensagem: 'A importação não foi encontrada.' }]);
    expect((await seguir([{ ok: false, erros: [{ campo: '_', mensagem: 'Sua sessão expirou.' }] }])).eventos).toEqual([
      { tipo: 'erro', mensagem: 'Sua sessão expirou.' },
    ]);
  });

  it('desiste depois do máximo de consultas e avisa', async () => {
    const r = await seguir([], { maxConsultas: 3 });
    expect(r.consultar).toHaveBeenCalledTimes(3);
    expect(r.eventos.at(-1)).toEqual({ tipo: 'esgotado' });
  });

  it('cancelado (saída da tela) não consulta nem avisa', async () => {
    const r = await seguir([], { cancelado: () => true });
    expect(r.consultar).not.toHaveBeenCalled();
    expect(r.eventos).toEqual([]);
  });
});

describe('ImportarEstrutura (SSR)', () => {
  const nada = async () => ({ ok: true as const, valor: null });
  it('campo de arquivo .xlsx, com rótulo, e o status vazio', () => {
    const html = renderToString(
      createElement(ImportarEstrutura, { rotulo: 'Planilha (.xlsx)', importar: async () => ({ ok: true as const, valor: { cargaId: 'x', avisos: [] } }), consultar: nada }),
    );
    expect(html).toMatch(/<label for="importar-arquivo">Planilha \(\.xlsx\)<\/label>/);
    expect(html).toMatch(/<input id="importar-arquivo" type="file" accept="\.xlsx,[^"]*" name="arquivo"\/>/);
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });

  it('a lista mostra o total e avisa quando corta em 200', () => {
    const erros = Array.from({ length: 250 }, (_, i) => ({ linha: i + 2, coluna: 'Nível', mensagem: `erro ${i}` }));
    const html = renderToString(createElement(ListaLinhas, { titulo: 'Erros', id: 'erros', resumo: resumir(erros), instrucao: 'Corrija.' }));
    expect(html).toMatch(/<h2 id="titulo-erros">Erros: 250<\/h2>/);
    expect(html).toContain('Mostrando os 200 primeiros.');
    const avisos = renderToString(createElement(ListaLinhas, { titulo: 'Avisos', id: 'avisos', resumo: resumir(erros.slice(0, 3)), instrucao: 'Não impedem.' }));
    expect(avisos).toMatch(/<h2 id="titulo-avisos">Avisos: 3<\/h2>/);
    expect(avisos).not.toContain('Mostrando');
  });
});
