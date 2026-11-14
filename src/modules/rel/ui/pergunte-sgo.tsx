'use client';

import { useRef, useState } from 'react';
import type { ErroCampo } from '@/shared/kernel';
import { MAXIMO_PERGUNTA } from '../domain/ajuda-manual';
import type { Resposta } from '../domain/pergunte-sgo';

// Pergunte ao SGO (US-104): campo, espera, erro e a resposta com o número, a fonte e o link. O número vem do
// sistema; a IA só entendeu a pergunta (por isso o selo fala da interpretação). Componente cliente: recebe a
// Server Action por props.

export type RespostaPerguntaTela = { ok: true; valor: Resposta } | { ok: false; erros: readonly ErroCampo[] };
export type EstadoPergunta = { tipo: 'OCIOSO' } | { tipo: 'CONSULTANDO' } | { tipo: 'ERRO'; mensagem: string } | { tipo: 'PRONTA'; resposta: Resposta };

export const TEXTOS_PERGUNTE = {
  ROTULO: 'Sua pergunta',
  AVISO: 'A IA só interpreta a pergunta; o número vem do sistema, com a fonte e o link, dentro das suas permissões. Não escreva dados pessoais.',
  BOTAO: 'Perguntar',
  CONSULTANDO: 'Consultando…',
  PRONTA: 'Resposta pronta.',
  SELO: 'Pergunta interpretada com IA – confira a fonte',
  FONTE: 'Fonte',
  ABRIR: 'Abrir a tela',
  FALHA: 'Não foi possível consultar. Verifique a conexão e tente de novo.',
} as const;

export function estadoDaPergunta(r: RespostaPerguntaTela): EstadoPergunta {
  return r.ok ? { tipo: 'PRONTA', resposta: r.valor } : { tipo: 'ERRO', mensagem: r.erros.map((e) => e.mensagem).join(' ') };
}

/** A resposta (puro: testável sem DOM). */
export function ConteudoResposta({ estado }: { estado: EstadoPergunta }) {
  if (estado.tipo !== 'PRONTA') return null;
  const r = estado.resposta;
  return (
    <div>
      <p>
        <strong>{TEXTOS_PERGUNTE.SELO}</strong>
      </p>
      <p>{r.texto}</p>
      {r.tipo !== 'NAO_SEI' && r.fonte && (
        <p>
          {TEXTOS_PERGUNTE.FONTE}: {r.fonte}
          {r.link && (
            <>
              {' · '}
              <a href={r.link}>{TEXTOS_PERGUNTE.ABRIR}</a>
            </>
          )}
        </p>
      )}
    </div>
  );
}

export function PergunteSgo({ perguntar }: { perguntar: (entrada: { pergunta: string }) => Promise<RespostaPerguntaTela> }) {
  const [estado, setEstado] = useState<EstadoPergunta>({ tipo: 'OCIOSO' });
  const [pergunta, setPergunta] = useState('');
  const [erroCampo, setErroCampo] = useState(false);
  // Ref, e não só o estado: dois envios seguidos não disparam duas consultas.
  const ocupado = useRef(false);
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (ocupado.current) return;
    ocupado.current = true;
    setEstado({ tipo: 'CONSULTANDO' });
    setErroCampo(false);
    try {
      const r = await perguntar({ pergunta });
      setErroCampo(!r.ok && r.erros.some((x) => x.campo === 'pergunta'));
      setEstado(estadoDaPergunta(r));
    } catch {
      setEstado({ tipo: 'ERRO', mensagem: TEXTOS_PERGUNTE.FALHA });
    } finally {
      ocupado.current = false;
    }
  };
  return (
    <section aria-labelledby="pergunte-titulo">
      <h2 id="pergunte-titulo">Pergunte ao SGO</h2>
      <form onSubmit={enviar}>
        <p>
          <label htmlFor="pergunte-texto">{TEXTOS_PERGUNTE.ROTULO}</label>
          <textarea
            id="pergunte-texto"
            rows={2}
            maxLength={MAXIMO_PERGUNTA}
            value={pergunta}
            onChange={(e) => setPergunta(e.target.value)}
            aria-invalid={erroCampo || undefined}
            aria-describedby={erroCampo ? 'pergunte-aviso pergunte-erro' : 'pergunte-aviso'}
          />
        </p>
        <p role="note" id="pergunte-aviso">
          {TEXTOS_PERGUNTE.AVISO}
        </p>
        {/* aria-disabled, e não disabled, para o foco ficar no botão durante a consulta. */}
        <button type="submit" aria-disabled={estado.tipo === 'CONSULTANDO'}>
          {TEXTOS_PERGUNTE.BOTAO}
        </button>
      </form>
      <p role="status" aria-live="polite">
        {estado.tipo === 'CONSULTANDO' ? TEXTOS_PERGUNTE.CONSULTANDO : estado.tipo === 'PRONTA' ? TEXTOS_PERGUNTE.PRONTA : ''}
      </p>
      {estado.tipo === 'ERRO' && (
        <p role="alert" id="pergunte-erro">
          {estado.mensagem}
        </p>
      )}
      <ConteudoResposta estado={estado} />
    </section>
  );
}
