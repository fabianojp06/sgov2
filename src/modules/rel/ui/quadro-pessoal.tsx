'use client';

import { useRef, useState } from 'react';
import type { ErroCampo } from '@/shared/kernel';
import type { QuadroAdmCentral } from '../domain/quadro-adm-central';
import type { AnaliseQuadro, QuadroPessoal } from '../domain/quadro-pessoal';
import { TabelaAdmCentral, TabelaQuadro } from './quadro-pessoal-tabela';

// Análise do quadro de pessoal pela IA (US-107): botão, espera, erro e a análise com o selo "Gerado com
// IA – revisar" (spec §6.8, princípio 3), seguida dos agregados enviados. Componente cliente: recebe a
// Server Action por props; nada aqui chama a IA.

export type FiltrosAnalise = { tipo: string; proposta: string; ano: string };
type Analisado = { analise: AnaliseQuadro; quadro: QuadroPessoal | null; admCentral: QuadroAdmCentral | null };
export type RespostaQuadroTela = { ok: true; valor: Analisado } | { ok: false; erros: readonly ErroCampo[] };
export type EstadoQuadro =
  | { tipo: 'OCIOSO' }
  | { tipo: 'CONSULTANDO' }
  | { tipo: 'ERRO'; mensagem: string }
  | ({ tipo: 'PRONTA' } & Analisado);

export const TEXTOS_ANALISE = {
  TITULO: 'Análise com IA',
  AVISO: 'A IA recebe só os agregados mostrados nesta página (sem nomes nem salários individuais) e só redige a análise: confira os números nas tabelas.',
  BOTAO: 'Analisar com IA',
  CONSULTANDO: 'Consultando a IA…',
  PRONTA: 'Análise pronta.',
  SELO: 'Gerado com IA – revisar',
  DESTAQUES: 'Destaques',
  ALERTAS: 'Pontos de atenção',
  ENVIADO: 'Agregados enviados à IA',
  FALHA: 'Não foi possível consultar a IA. Verifique a conexão e tente de novo.',
} as const;

export function estadoDaAnalise(r: RespostaQuadroTela): EstadoQuadro {
  return r.ok ? { tipo: 'PRONTA', ...r.valor } : { tipo: 'ERRO', mensagem: r.erros.map((e) => e.mensagem).join(' ') };
}

/** A análise pronta (fora da região viva, para o leitor de tela não anunciar as tabelas inteiras). */
export function ConteudoAnalise({ estado }: { estado: EstadoQuadro }) {
  if (estado.tipo !== 'PRONTA') return null;
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
        {estado.quadro && <TabelaQuadro quadro={estado.quadro} prefixo="enviado" />}
        {estado.admCentral && <TabelaAdmCentral quadro={estado.admCentral} prefixo="enviado-adm" />}
      </details>
    </>
  );
}

/** O aviso curto da região viva, por estado (puro: testável sem DOM). */
export function avisoDaAnalise(estado: EstadoQuadro): string {
  switch (estado.tipo) {
    case 'CONSULTANDO':
      return TEXTOS_ANALISE.CONSULTANDO;
    case 'PRONTA':
      return TEXTOS_ANALISE.PRONTA;
    default:
      return '';
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
      <p role="status" aria-live="polite">
        {avisoDaAnalise(estado)}
      </p>
      {estado.tipo === 'ERRO' && <p role="alert">{estado.mensagem}</p>}
      <ConteudoAnalise estado={estado} />
    </section>
  );
}
