'use client';

import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import { GradeArvore, type NoGrade } from '@/modules/ger';
import type { ErroLinha } from '../domain/plano-contas';
import {
  acompanharCarga,
  resumir,
  separarErros,
  textoSituacao,
  type EstadoCargaTela,
  type Resposta,
} from './importar-estrutura-logica';

// Tela de importação do plano de contas (US-043 parte 4; plano do P4, Task 7a). Envia o .xlsx, mostra
// os erros por linha (até 200, com o total) e acompanha o lote a cada 2 s até o fim. Formulário
// próprio, como a Tabela Mestre: o Formulario do C3 não devolve o resultado da ação (o id do lote)
// e listaria todos os erros no resumo.
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
  const [enviando, iniciar] = useTransition();
  const [erroArquivo, setErroArquivo] = useState<string[]>([]);
  const [gerais, setGerais] = useState<string[]>([]);
  const [errosLinha, setErrosLinha] = useState<readonly ErroLinha[]>([]);
  const [avisos, setAvisos] = useState<readonly ErroLinha[]>([]);
  const [estado, setEstado] = useState<EstadoCargaTela | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cargaId, setCargaId] = useState<string | null>(null);
  const [terminou, setTerminou] = useState(false);
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  // Acompanha o lote pedido; a troca de lote ou a saída da tela encerra o acompanhamento anterior.
  useEffect(() => {
    if (!cargaId) return;
    let cancelado = false;
    void acompanharCarga({
      cargaId,
      consultar,
      cancelado: () => cancelado,
      aoAtualizar: (a) => {
        if (a.tipo === 'estado') {
          setEstado(a.estado);
          if (a.estado.situacao === 'FALHOU') {
            setErrosLinha(a.estado.erros);
            setGerais(a.estado.erro ? [a.estado.erro] : []);
          }
          if (a.estado.situacao === 'CONCLUIDA' || a.estado.situacao === 'FALHOU') setTerminou(true);
          return;
        }
        setTerminou(true);
        if (a.tipo === 'erro') setGerais([a.mensagem]);
        else setAviso('A importação continua em andamento. Consulte o plano de contas mais tarde para ver o resultado.');
      },
    });
    return () => {
      cancelado = true;
    };
  }, [cargaId, consultar]);

  const acompanhando = cargaId !== null && !terminou;

  const enviar = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const dados = new FormData(e.currentTarget);
    setErroArquivo([]);
    setGerais([]);
    setErrosLinha([]);
    setAvisos([]);
    setEstado(null);
    setAviso(null);
    setCargaId(null);
    setTerminou(false);
    iniciar(async () => {
      const r = await importar(dados);
      if (!montado.current) return;
      if (r.ok) {
        setAvisos(r.valor.avisos);
        setCargaId(r.valor.cargaId);
        return;
      }
      const s = separarErros(r.erros);
      setErroArquivo(s.arquivo);
      setErrosLinha(s.linhas);
      setGerais(s.gerais);
    });
  };

  const erros = resumir(errosLinha);
  const avisosResumo = resumir(avisos);
  const idErroArquivo = 'importar-arquivo-erro';

  return (
    <section>
      <form onSubmit={enviar} aria-busy={enviando} noValidate>
        <label htmlFor="importar-arquivo">{rotulo}</label>{' '}
        <input
          id="importar-arquivo"
          type="file"
          name="arquivo"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          {...(erroArquivo.length > 0 ? { 'aria-invalid': true, 'aria-describedby': idErroArquivo } : {})}
        />
        {erroArquivo.length > 0 && (
          <span id={idErroArquivo} role="alert">
            {erroArquivo.join(' ')}
          </span>
        )}{' '}
        <button type="submit" disabled={enviando || acompanhando}>
          Importar
        </button>
      </form>
      {gerais.length > 0 && (
        <ul role="alert">
          {gerais.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
      <p role="status">{estado ? textoSituacao(estado) : (aviso ?? '')}</p>
      {estado && aviso && <p>{aviso}</p>}
      {erros.total > 0 && <ListaLinhas titulo="Erros" id="erros" resumo={erros} instrucao="Corrija a planilha e importe de novo: nada foi gravado." />}
      {avisosResumo.total > 0 && <ListaLinhas titulo="Avisos" id="avisos" resumo={avisosResumo} instrucao="Os avisos não impedem a importação." />}
    </section>
  );
}

export function ListaLinhas({ titulo, id, resumo, instrucao }: { titulo: string; id: string; resumo: { mostrados: readonly ErroLinha[]; total: number }; instrucao: string }) {
  const nos: NoGrade<Colunas>[] = resumo.mostrados.map((e, i) => ({
    id: `${id}-${i}`,
    linha: { linha: e.linha > 0 ? String(e.linha) : '—', coluna: e.coluna ?? '—', mensagem: e.mensagem },
  }));
  return (
    <section aria-labelledby={`titulo-${id}`}>
      <h2 id={`titulo-${id}`}>{`${titulo}: ${resumo.total}`}</h2>
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
