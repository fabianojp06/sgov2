'use client';

import { useEffect, useReducer, useRef, useTransition, type FormEvent, type Ref } from 'react';
import { GradeArvore, type NoGrade } from '@/modules/ger';
import { problemaArquivoCarga } from '../domain/arquivo-carga';
import type { ErroLinha } from '../domain/plano-contas';
import {
  acompanharCarga,
  podeEnviar,
  reduzirTela,
  resumir,
  TELA_INICIAL,
  textoStatus,
  type EstadoCargaTela,
  type Resposta,
} from './importar-estrutura-logica';

// Tela de importação do plano de contas (US-043 parte 4; plano do P4, Task 7a). Envia o .xlsx, mostra
// os erros por linha (até 200, com o total) e acompanha o lote a cada 2 s até o fim. Formulário
// próprio, como a Tabela Mestre: o Formulario do C3 não devolve o resultado da ação (o id do lote)
// e listaria todos os erros no resumo. O estado da tela é o redutor puro de importar-estrutura-logica.
type Colunas = 'linha' | 'coluna' | 'mensagem';

export function ImportarEstrutura({
  rotulo,
  importar,
  consultar,
}: {
  rotulo: string;
  importar: (dados: FormData) => Promise<Resposta<{ cargaId: string; avisos: readonly ErroLinha[] }>>;
  consultar: (e: { cargaId: string }) => Promise<Resposta<EstadoCargaTela | null>>;
}) {
  const [s, despachar] = useReducer(reduzirTela, TELA_INICIAL);
  const [, iniciar] = useTransition();
  const montado = useRef(true);
  const tituloErros = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  // Acompanha o lote pedido; a troca de lote ou a saída da tela encerra o acompanhamento anterior.
  useEffect(() => {
    if (!s.cargaId) return;
    let cancelado = false;
    void acompanharCarga({ cargaId: s.cargaId, consultar, cancelado: () => cancelado, aoAtualizar: despachar });
    return () => {
      cancelado = true;
    };
  }, [s.cargaId, consultar]);

  // Com erros por linha, o foco vai para o resumo deles (teclado e leitor de tela).
  useEffect(() => {
    if (s.errosLinha.length > 0) tituloErros.current?.focus();
  }, [s.errosLinha]);

  const enviar = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const dados = new FormData(e.currentTarget);
    const arquivo = dados.get('arquivo');
    const problema = problemaArquivoCarga(arquivo instanceof File ? { nome: arquivo.name, tamanho: arquivo.size } : null);
    if (problema) return despachar({ tipo: 'arquivoRecusado', mensagem: problema });
    despachar({ tipo: 'enviar' });
    iniciar(async () => {
      try {
        const resposta = await importar(dados);
        if (montado.current) despachar({ tipo: 'resposta', resposta });
      } catch {
        // Corpo acima do limite do Next, rede ou servidor fora: mensagem na tela, nunca o error.tsx (spec §5).
        if (montado.current) despachar({ tipo: 'falhaEnvio' });
      }
    });
  };

  const erros = resumir(s.errosLinha);
  const avisos = resumir(s.avisos);
  const idErroArquivo = 'importar-arquivo-erro';

  return (
    <section>
      <form onSubmit={enviar} aria-busy={s.fase === 'enviando'} noValidate>
        <label htmlFor="importar-arquivo">{rotulo}</label>{' '}
        <input
          id="importar-arquivo"
          type="file"
          name="arquivo"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          {...(s.erroArquivo.length > 0 ? { 'aria-invalid': true, 'aria-describedby': idErroArquivo } : {})}
        />
        {s.erroArquivo.length > 0 && (
          <span id={idErroArquivo} role="alert">
            {s.erroArquivo.join(' ')}
          </span>
        )}{' '}
        <button type="submit" disabled={!podeEnviar(s)}>
          Importar
        </button>
      </form>
      <p role="status">{textoStatus(s)}</p>
      {s.gerais.length > 0 && (
        <ul role="alert">
          {s.gerais.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
      {erros.total > 0 && (
        <ListaLinhas titulo="Erros" id="erros" resumo={erros} instrucao="Corrija a planilha e importe de novo: nada foi gravado." refTitulo={tituloErros} />
      )}
      {avisos.total > 0 && <ListaLinhas titulo="Avisos" id="avisos" resumo={avisos} instrucao="Os avisos não impedem a importação." />}
    </section>
  );
}

export function ListaLinhas({
  titulo,
  id,
  resumo,
  instrucao,
  refTitulo,
}: {
  titulo: string;
  id: string;
  resumo: { mostrados: readonly ErroLinha[]; total: number };
  instrucao: string;
  refTitulo?: Ref<HTMLHeadingElement>;
}) {
  const nos: NoGrade<Colunas>[] = resumo.mostrados.map((e, i) => ({
    id: `${id}-${i}`,
    linha: { linha: e.linha > 0 ? String(e.linha) : '—', coluna: e.coluna ?? '—', mensagem: e.mensagem },
  }));
  return (
    <section aria-labelledby={`titulo-${id}`}>
      <h2 id={`titulo-${id}`} ref={refTitulo} tabIndex={-1}>{`${titulo}: ${resumo.total}`}</h2>
      <p>
        {instrucao}
        {resumo.total > resumo.mostrados.length && ` Mostrando os ${resumo.mostrados.length} primeiros.`}
      </p>
      <GradeArvore<Colunas>
        idGrade={`cad.importacao.${id}`}
        rotulo={titulo}
        nos={nos}
        colunas={[
          { campo: 'linha', titulo: 'Linha', tipo: 'texto' },
          { campo: 'coluna', titulo: 'Coluna', tipo: 'texto' },
          { campo: 'mensagem', titulo: 'Mensagem', tipo: 'texto' },
        ]}
        alturaVisivel={320}
      />
    </section>
  );
}
