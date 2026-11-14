'use client';

import { useRef, useState } from 'react';
import type { ErroCampo } from '@/shared/kernel';
import type { AnaliseQuadro, QuadroPessoal } from '../domain/quadro-pessoal';
import { TabelaQuadro } from './quadro-pessoal-tabela';

// Análise do quadro de pessoal pela IA (US-107): botão, espera, erro e a análise com o selo "Gerado com
// IA – revisar" (spec §6.8, princípio 3), seguida dos agregados enviados. Componente cliente: recebe a
// Server Action por props; nada aqui chama a IA.

export type FiltrosAnalise = { tipo: string; proposta: string };
export type RespostaQuadroTela = { ok: true; valor: { analise: AnaliseQuadro; quadro: QuadroPessoal } } | { ok: false; erros: readonly ErroCampo[] };
export type EstadoQuadro =
  | { tipo: 'OCIOSO' }
  | { tipo: 'CONSULTANDO' }
  | { tipo: 'ERRO'; mensagem: string }
  | { tipo: 'PRONTA'; analise: AnaliseQuadro; quadro: QuadroPessoal };

export const TEXTOS_ANALISE = {
  TITULO: 'Análise com IA',
  AVISO: 'A IA recebe só os agregados mostrados nesta página (sem nomes nem salários individuais) e só redige a análise: confira os números nas tabelas.',
  BOTAO: 'Analisar com IA',
  CONSULTANDO: 'Consultando a IA…',
  SELO: 'Gerado com IA – revisar',
  DESTAQUES: 'Destaques',
  ALERTAS: 'Pontos de atenção',
  ENVIADO: 'Agregados enviados à IA',
  FALHA: 'Não foi possível consultar a IA. Verifique a conexão e tente de novo.',
} as const;

export function estadoDaAnalise(r: RespostaQuadroTela): EstadoQuadro {
  return r.ok ? { tipo: 'PRONTA', ...r.valor } : { tipo: 'ERRO', mensagem: r.erros.map((e) => e.mensagem).join(' ') };
}

/** O conteúdo da região viva, por estado (puro: testável sem DOM). */
export function ConteudoAnalise({ estado }: { estado: EstadoQuadro }) {
  switch (estado.tipo) {
    case 'CONSULTANDO':
      return <p>{TEXTOS_ANALISE.CONSULTANDO}</p>;
    case 'ERRO':
      return <p>{estado.mensagem}</p>;
    case 'PRONTA':
      return (
        <>
          <p>
            <strong>{TEXTOS_ANALISE.SELO}</strong>
          </p>
          <p>{estado.analise.resumo}</p>
          {estado.analise.destaques.length > 0 && (
            <>
              <h3>{TEXTOS_ANALISE.DESTAQUES}</h3>
              <ul>
                {estado.analise.destaques.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </>
          )}
          {estado.analise.alertas.length > 0 && (
            <>
              <h3>{TEXTOS_ANALISE.ALERTAS}</h3>
              <ul>
                {estado.analise.alertas.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </>
          )}
          <details>
            <summary>{TEXTOS_ANALISE.ENVIADO}</summary>
            <TabelaQuadro quadro={estado.quadro} />
          </details>
        </>
      );
    default:
      return null;
  }
}

export function AnaliseQuadroIA({ filtros, analisar }: { filtros: FiltrosAnalise; analisar: (entrada: FiltrosAnalise) => Promise<RespostaQuadroTela> }) {
  const [estado, setEstado] = useState<EstadoQuadro>({ tipo: 'OCIOSO' });
  // Ref, e não só o estado: dois cliques seguidos não disparam duas consultas.
  const ocupado = useRef(false);
  const enviar = async () => {
    if (ocupado.current) return;
    ocupado.current = true;
    setEstado({ tipo: 'CONSULTANDO' });
    try {
      setEstado(estadoDaAnalise(await analisar(filtros)));
    } catch {
      setEstado({ tipo: 'ERRO', mensagem: TEXTOS_ANALISE.FALHA });
    } finally {
      ocupado.current = false;
    }
  };
  return (
    <section aria-labelledby="quadro-ia-titulo">
      <h2 id="quadro-ia-titulo">{TEXTOS_ANALISE.TITULO}</h2>
      <p role="note" id="quadro-ia-aviso">
        {TEXTOS_ANALISE.AVISO}
      </p>
      {/* aria-disabled, e não disabled, para o foco ficar no botão durante a consulta. */}
      <button type="button" onClick={enviar} aria-disabled={estado.tipo === 'CONSULTANDO'} aria-describedby="quadro-ia-aviso">
        {TEXTOS_ANALISE.BOTAO}
      </button>
      <div role="status" aria-live="polite">
        <ConteudoAnalise estado={estado} />
      </div>
    </section>
  );
}
