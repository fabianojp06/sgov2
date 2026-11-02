import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ImportarEstrutura, ListaLinhas } from './importar-estrutura';
import { LIMITE_ARQUIVO_CARGA, MSG_ARQUIVO, problemaArquivoCarga } from '../domain/arquivo-carga';
import {
  acompanharCarga,
  INTERVALO_CONSULTA_MS,
  MSG_ESGOTADO,
  MSG_FALHA_CONSULTA,
  MSG_FALHA_ENVIO,
  podeEnviar,
  reduzirTela,
  resumir,
  resumoErros,
  separarErros,
  TELA_INICIAL,
  textoSituacao,
  textoStatus,
  type Acompanhamento,
  type EstadoCargaTela,
  type EstadoTela,
  type EventoTela,
  type Resposta,
} from './importar-estrutura-logica';

// Tela de importação do plano de contas (plano do P4, Task 7a, Step 1).
const estado = (situacao: EstadoCargaTela['situacao'], extra: Partial<EstadoCargaTela> = {}): EstadoCargaTela => ({
  cargaId: '6f1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d',
  tipo: 'PLANO_CONTAS',
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
        { campo: 'aprovacao.data', mensagem: 'Data inválida.' },
      ]),
    ).toEqual({
      arquivo: ['O arquivo deve ser .xlsx.'],
      linhas: [
        { linha: 12, coluna: 'Classificação', mensagem: 'Classificação repetida.' },
        { linha: 3, mensagem: 'Linha sem dados.' },
      ],
      gerais: ['Sessão expirada.'],
      campos: { 'aprovacao.data': ['Data inválida.'] },
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
    expect(textoSituacao(estado('FALHOU'))).toBe('A importação falhou e nada foi gravado.');
    expect(textoSituacao(estado('FALHOU', { erros: [{ linha: 4, mensagem: 'x' }] }))).toBe('A importação falhou e nada foi gravado. Confira os erros abaixo.');
    expect(textoSituacao(estado('PROCESSANDO'))).toBe('Importando 174 linhas…');
    expect(textoSituacao(estado('CONCLUIDA', { tipo: 'CENTROS_CUSTO', incluidas: 60, alteradas: 0, inativadas: 0, inalteradas: 2 }))).toBe(
      'Centros de custo importados: 60 incluídos, 0 alterados, 0 inativados, 2 sem alteração.',
    );
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

  it('a consulta que lança (rede, deploy) encerra com a mensagem, sem deixar a tela presa', async () => {
    const eventos: Acompanhamento[] = [];
    await acompanharCarga({
      cargaId: 'x',
      consultar: async () => {
        throw new TypeError('Failed to fetch');
      },
      esperar: async () => {},
      aoAtualizar: (a) => eventos.push(a),
    });
    expect(eventos).toEqual([{ tipo: 'erro', mensagem: MSG_FALHA_CONSULTA }]);
  });

  it('cancelado (saída da tela) não consulta nem avisa', async () => {
    const r = await seguir([], { cancelado: () => true });
    expect(r.consultar).not.toHaveBeenCalled();
    expect(r.eventos).toEqual([]);
  });
});

describe('problemaArquivoCarga (o mesmo texto na tela e na ação)', () => {
  it('ausente, vazio, extensão e tamanho', () => {
    expect(problemaArquivoCarga(null)).toBe(MSG_ARQUIVO.ausente);
    expect(problemaArquivoCarga({ nome: '', tamanho: 0 })).toBe(MSG_ARQUIVO.ausente);
    expect(problemaArquivoCarga({ nome: 'p.xlsx', tamanho: 0 })).toBe(MSG_ARQUIVO.vazio);
    expect(problemaArquivoCarga({ nome: 'p.csv', tamanho: 10 })).toBe(MSG_ARQUIVO.extensao);
    expect(problemaArquivoCarga({ nome: 'p.xlsx', tamanho: LIMITE_ARQUIVO_CARGA + 1 })).toBe(MSG_ARQUIVO.tamanho);
    expect(problemaArquivoCarga({ nome: 'Plano.XLSX', tamanho: LIMITE_ARQUIVO_CARGA })).toBeNull();
  });
});

describe('reduzirTela', () => {
  const passar = (...eventos: EventoTela[]): EstadoTela => eventos.reduce(reduzirTela, TELA_INICIAL);
  const enviado: EventoTela = { tipo: 'resposta', resposta: { ok: true, valor: { cargaId: 'c1', avisos: [{ linha: 3, mensagem: 'Nome retirado.' }] } } };

  it('envio aceito: acompanha o lote com o botão bloqueado e os avisos do saneamento', () => {
    const s = passar({ tipo: 'enviar' }, enviado, { tipo: 'estado', estado: estado('PROCESSANDO') });
    expect(s).toMatchObject({ fase: 'acompanhando', cargaId: 'c1', avisos: [{ linha: 3 }] });
    expect(podeEnviar(s)).toBe(false);
    expect(podeEnviar(passar({ tipo: 'enviar' }))).toBe(false);
    expect(textoStatus(passar({ tipo: 'enviar' }))).toBe('Enviando o arquivo…');
    expect(textoStatus(s)).toBe('Importando 174 linhas…');
  });

  it('CONCLUIDA: libera o botão e junta os avisos do envio (saneamento) com os do lote (R5), sem repetir', () => {
    const avisoR5 = { linha: 9, coluna: 'Código reduzido', mensagem: 'O reduzido 900 passou de uma conta para outra: a antiga foi inativada.' };
    const repetido = { linha: 3, mensagem: 'Nome retirado.' };
    const s = passar({ tipo: 'enviar' }, enviado, { tipo: 'estado', estado: estado('CONCLUIDA', { avisos: [repetido, avisoR5], incluidas: 1, inalteradas: 173 }) });
    expect(s.fase).toBe('fim');
    expect(podeEnviar(s)).toBe(true);
    expect(s.avisos).toEqual([{ linha: 3, mensagem: 'Nome retirado.' }, avisoR5]);
    expect(textoStatus(s)).toMatch(/^Plano de contas importado: 1 incluídas/);
  });

  it('FALHOU: libera o botão, com os erros por linha e a mensagem geral do lote', () => {
    const erros = [{ linha: 12, coluna: 'Classificação', mensagem: 'Diverge do plano atual.' }];
    const s = passar({ tipo: 'enviar' }, enviado, { tipo: 'estado', estado: estado('FALHOU', { erros, erro: 'A carga diverge do plano de contas atual.' }) });
    expect(s).toMatchObject({ fase: 'fim', errosLinha: erros, gerais: ['A carga diverge do plano de contas atual.'] });
    expect(podeEnviar(s)).toBe(true);
  });

  it('envio recusado: erros do arquivo, por linha e gerais, e o botão livre', () => {
    const s = passar(
      { tipo: 'enviar' },
      { tipo: 'resposta', resposta: { ok: false, erros: [{ campo: 'arquivo', mensagem: 'Planilha inválida.' }, { campo: 'linhas.5.Nível', mensagem: 'Nível inválido.' }, { campo: '_', mensagem: 'Outro.' }] } },
    );
    expect(s).toMatchObject({ fase: 'ocioso', erroArquivo: ['Planilha inválida.'], errosLinha: [{ linha: 5, coluna: 'Nível' }], gerais: ['Outro.'] });
    const comCampo = reduzirTela(s, { tipo: 'resposta', resposta: { ok: false, erros: [{ campo: '_', mensagem: 'Geral.' }, { campo: 'aprovacao', mensagem: 'DIREX.' }] } });
    expect(comCampo.campos).toEqual({ aprovacao: ['DIREX.'] });
    // O resumo do topo leva os erros gerais e os dos campos extras.
    expect(resumoErros(comCampo)).toEqual(['Geral.', 'DIREX.']);
    expect(reduzirTela(comCampo, { tipo: 'enviar' }).campos).toEqual({});
    expect(podeEnviar(s)).toBe(true);
  });

  it('falha do envio, erro da consulta e esgotado: mensagem e o botão livre', () => {
    expect(passar({ tipo: 'enviar' }, { tipo: 'falhaEnvio' })).toMatchObject({ fase: 'ocioso', gerais: [MSG_FALHA_ENVIO] });
    const erro = passar({ tipo: 'enviar' }, enviado, { tipo: 'erro', mensagem: MSG_FALHA_CONSULTA });
    expect(erro).toMatchObject({ fase: 'fim', gerais: [MSG_FALHA_CONSULTA] });
    expect(podeEnviar(erro)).toBe(true);
    const esgotado = passar({ tipo: 'enviar' }, enviado, { tipo: 'estado', estado: estado('PROCESSANDO') }, { tipo: 'esgotado' });
    expect(podeEnviar(esgotado)).toBe(true);
    // O aviso vai para o role="status", no lugar do "Importando…".
    expect(textoStatus(esgotado)).toBe(MSG_ESGOTADO);
  });

  it('novo envio limpa o resultado anterior; arquivo recusado no cliente fica só no campo', () => {
    const antes = passar({ tipo: 'enviar' }, enviado, { tipo: 'estado', estado: estado('FALHOU', { erros: [{ linha: 2, mensagem: 'x' }] }) });
    expect(reduzirTela(antes, { tipo: 'enviar' })).toEqual({ ...TELA_INICIAL, fase: 'enviando' });
    expect(reduzirTela(antes, { tipo: 'arquivoRecusado', mensagem: MSG_ARQUIVO.tamanho })).toEqual({ ...TELA_INICIAL, erroArquivo: [MSG_ARQUIVO.tamanho] });
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
    // O botão começa livre (um disabled invertido o deixaria bloqueado).
    expect(html).toMatch(/<button type="submit">Importar<\/button>/);
  });

  it('a lista mostra o total e avisa quando corta em 200', () => {
    const erros = Array.from({ length: 250 }, (_, i) => ({ linha: i + 2, coluna: 'Nível', mensagem: `erro ${i}` }));
    const html = renderToString(createElement(ListaLinhas, { titulo: 'Erros', id: 'erros', resumo: resumir(erros), instrucao: 'Corrija.' }));
    expect(html).toMatch(/<h2 id="titulo-erros" tabindex="-1">Erros: 250<\/h2>/);
    expect(html).toContain('Mostrando os 200 primeiros.');
    const avisos = renderToString(createElement(ListaLinhas, { titulo: 'Avisos', id: 'avisos', resumo: resumir(erros.slice(0, 3)), instrucao: 'Não impedem.' }));
    expect(avisos).toMatch(/<h2 id="titulo-avisos" tabindex="-1">Avisos: 3<\/h2>/);
    expect(avisos).not.toContain('Mostrando');
  });
});
