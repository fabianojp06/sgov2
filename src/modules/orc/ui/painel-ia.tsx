'use client';

import { useRef, useState, type ReactNode } from 'react';
import type { ErroCampo } from '@/shared/kernel';
import { MENSAGENS_ORC } from '../domain/mensagens';

// Painel da ajuda da IA (plano do P14; reutilizado nas Tasks 2 e 3): botão, espera, erro e a resposta
// com o selo "Gerado com IA – revisar" (spec §6.8, princípio 3). Componente cliente: recebe a
// consulta por props (a Server Action do orc); nada aqui chama a IA nem grava dado. O que fazer com a
// resposta ("Usar …") fica com quem usa o painel, que só preenche campos editáveis.
export type RespostaIaTela<T> = { ok: true; valor: T } | { ok: false; erros: readonly ErroCampo[] };

export type EstadoPainelIA<T> = { tipo: 'OCIOSO' } | { tipo: 'CONSULTANDO' } | { tipo: 'ERRO'; mensagem: string } | { tipo: 'PRONTA'; valor: T };

/** A resposta da ação vira o estado do painel: erro com as mensagens juntas, ou a sugestão pronta. */
export function estadoDaResposta<T>(r: RespostaIaTela<T>): EstadoPainelIA<T> {
  return r.ok ? { tipo: 'PRONTA', valor: r.valor } : { tipo: 'ERRO', mensagem: r.erros.map((e) => e.mensagem).join(' ') };
}

/** A resposta pronta: sempre com o selo da spec antes do conteúdo. */
export function RespostaPainelIA({ children }: { children: ReactNode }) {
  return (
    <>
      <p>
        <strong>{MENSAGENS_ORC.SELO_IA}</strong>
      </p>
      {children}
    </>
  );
}

/** O conteúdo da região viva, por estado (puro: testável sem DOM). */
export function ConteudoPainelIA<T>({ estado, children }: { estado: EstadoPainelIA<T>; children: (valor: T) => ReactNode }) {
  switch (estado.tipo) {
    case 'CONSULTANDO':
      return <p>{MENSAGENS_ORC.IA_CONSULTANDO}</p>;
    case 'ERRO':
      return <p>{estado.mensagem}</p>;
    case 'PRONTA':
      return <RespostaPainelIA>{children(estado.valor)}</RespostaPainelIA>;
    default:
      return null;
  }
}

export function PainelIA<T>({
  id,
  titulo,
  rotuloBotao,
  aviso,
  pedir,
  children,
}: {
  id: string;
  titulo: string;
  rotuloBotao: string;
  aviso?: string | undefined;
  pedir: () => Promise<RespostaIaTela<T>>;
  children: (valor: T) => ReactNode;
}) {
  const [estado, setEstado] = useState<EstadoPainelIA<T>>({ tipo: 'OCIOSO' });
  // Ref, e não só o estado: dois cliques seguidos não disparam duas consultas.
  const ocupado = useRef(false);
  const consultando = estado.tipo === 'CONSULTANDO';
  const consultar = async () => {
    if (ocupado.current) return;
    ocupado.current = true;
    setEstado({ tipo: 'CONSULTANDO' });
    try {
      setEstado(estadoDaResposta(await pedir()));
    } catch {
      setEstado({ tipo: 'ERRO', mensagem: MENSAGENS_ORC.IA_FALHA_CONSULTA });
    } finally {
      ocupado.current = false;
    }
  };
  return (
    <section aria-labelledby={`${id}-titulo`} className="painel-ia">
      <h3 id={`${id}-titulo`}>{titulo}</h3>
      {aviso && <p role="note">{aviso}</p>}
      {/* type="button": o painel fica dentro do formulário e não pode enviá-lo. aria-disabled, e não
          disabled, para o foco ficar no botão durante a consulta; o clique é ignorado. */}
      <button type="button" onClick={consultar} aria-disabled={consultando}>
        {rotuloBotao}
      </button>
      <div role="status" aria-live="polite">
        <ConteudoPainelIA estado={estado}>{children}</ConteudoPainelIA>
      </div>
    </section>
  );
}
