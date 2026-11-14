'use client';

import { useRef, useState } from 'react';
import type { ErroCampo } from '@/shared/kernel';
import type { Comparativo } from '../domain/comparativo-tps';
import type { AnaliseQuadro } from '../domain/quadro-pessoal';

// Comentários da IA sobre o comparativo entre TPs (US-106): botão, espera, erro e os comentários com o selo
// "Gerado com IA – revisar" (spec §6.8, princípio 3). A tabela fica na página (é a mesma que a IA recebe).
// A região viva só anuncia o aviso curto (como na US-107). Componente cliente: recebe a Server Action.

export type RespostaComparativoTela = { ok: true; valor: { analise: AnaliseQuadro; comparativo: Comparativo } } | { ok: false; erros: readonly ErroCampo[] };
export type EstadoComparativo = { tipo: 'OCIOSO' } | { tipo: 'CONSULTANDO' } | { tipo: 'ERRO'; mensagem: string } | { tipo: 'PRONTA'; analise: AnaliseQuadro };

export const TEXTOS_COMENTARIOS = {
  TITULO: 'Comentários com IA',
  AVISO: 'A IA recebe só os indicadores da tabela (sem nomes nem salários) e os pontos fora da curva calculados pelo sistema, e só comenta: confira na tabela.',
  BOTAO: 'Comentar com IA',
  CONSULTANDO: 'Consultando a IA…',
  PRONTA: 'Comentários prontos.',
  SELO: 'Gerado com IA – revisar',
  DESTAQUES: 'Destaques',
  ALERTAS: 'Pontos fora da curva',
  FALHA: 'Não foi possível consultar a IA. Verifique a conexão e tente de novo.',
} as const;

export function estadoDosComentarios(r: RespostaComparativoTela): EstadoComparativo {
  return r.ok ? { tipo: 'PRONTA', analise: r.valor.analise } : { tipo: 'ERRO', mensagem: r.erros.map((e) => e.mensagem).join(' ') };
}

export function avisoDosComentarios(e: EstadoComparativo): string {
  return e.tipo === 'CONSULTANDO' ? TEXTOS_COMENTARIOS.CONSULTANDO : e.tipo === 'PRONTA' ? TEXTOS_COMENTARIOS.PRONTA : '';
}

/** Os comentários prontos (puro: testável sem DOM). */
export function ConteudoComentarios({ estado }: { estado: EstadoComparativo }) {
  if (estado.tipo !== 'PRONTA') return null;
  const { resumo, destaques, alertas } = estado.analise;
  return (
    <>
      <p>
        <strong>{TEXTOS_COMENTARIOS.SELO}</strong>
      </p>
      <p>{resumo}</p>
      {destaques.length > 0 && (
        <>
          <h3>{TEXTOS_COMENTARIOS.DESTAQUES}</h3>
          <ul>
            {destaques.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </>
      )}
      {alertas.length > 0 && (
        <>
          <h3>{TEXTOS_COMENTARIOS.ALERTAS}</h3>
          <ul>
            {alertas.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

export function ComentariosComparativoIA({ comentar }: { comentar: (entrada: Record<string, never>) => Promise<RespostaComparativoTela> }) {
  const [estado, setEstado] = useState<EstadoComparativo>({ tipo: 'OCIOSO' });
  // Ref, e não só o estado: dois cliques seguidos não disparam duas consultas.
  const ocupado = useRef(false);
  const enviar = async () => {
    if (ocupado.current) return;
    ocupado.current = true;
    setEstado({ tipo: 'CONSULTANDO' });
    try {
      setEstado(estadoDosComentarios(await comentar({})));
    } catch {
      setEstado({ tipo: 'ERRO', mensagem: TEXTOS_COMENTARIOS.FALHA });
    } finally {
      ocupado.current = false;
    }
  };
  return (
    <section aria-labelledby="comparativo-ia-titulo">
      <h2 id="comparativo-ia-titulo">{TEXTOS_COMENTARIOS.TITULO}</h2>
      <p role="note" id="comparativo-ia-aviso">
        {TEXTOS_COMENTARIOS.AVISO}
      </p>
      {/* aria-disabled, e não disabled, para o foco ficar no botão durante a consulta. */}
      <button type="button" onClick={enviar} aria-disabled={estado.tipo === 'CONSULTANDO'} aria-describedby="comparativo-ia-aviso">
        {TEXTOS_COMENTARIOS.BOTAO}
      </button>
      <p role="status" aria-live="polite">
        {avisoDosComentarios(estado)}
      </p>
      {estado.tipo === 'ERRO' && <p role="alert">{estado.mensagem}</p>}
      <ConteudoComentarios estado={estado} />
    </section>
  );
}
