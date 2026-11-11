'use client';

import { useState, type ReactNode } from 'react';
import type { ErroCampo } from '@/shared/kernel';
import { MENSAGENS_ORC } from '../domain/mensagens';

// Painel da ajuda da IA (plano do P14; reutilizado nas Tasks 2 e 3): botão, espera, erro e a resposta
// com o selo "Gerado com IA – revisar" (spec §6.8, princípio 3). Componente cliente: recebe a
// consulta por props (a Server Action do orc); nada aqui chama a IA nem grava dado. O que fazer com a
// resposta ("Usar …") fica com quem usa o painel, que só preenche campos editáveis.
export type RespostaIaTela<T> = { ok: true; valor: T } | { ok: false; erros: readonly ErroCampo[] };

type Estado<T> = { tipo: 'OCIOSO' } | { tipo: 'CONSULTANDO' } | { tipo: 'ERRO'; mensagem: string } | { tipo: 'PRONTA'; valor: T };

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
  const [estado, setEstado] = useState<Estado<T>>({ tipo: 'OCIOSO' });
  const consultando = estado.tipo === 'CONSULTANDO';
  const consultar = async () => {
    setEstado({ tipo: 'CONSULTANDO' });
    try {
      const r = await pedir();
      setEstado(r.ok ? { tipo: 'PRONTA', valor: r.valor } : { tipo: 'ERRO', mensagem: r.erros.map((e) => e.mensagem).join(' ') });
    } catch {
      setEstado({ tipo: 'ERRO', mensagem: MENSAGENS_ORC.IA_FALHA_CONSULTA });
    }
  };
  return (
    <section aria-labelledby={`${id}-titulo`} className="painel-ia">
      <h3 id={`${id}-titulo`}>{titulo}</h3>
      {aviso && <p role="note">{aviso}</p>}
      {/* type="button": o painel fica dentro do formulário e não pode enviá-lo. */}
      <button type="button" onClick={consultar} disabled={consultando} aria-busy={consultando}>
        {consultando ? MENSAGENS_ORC.IA_CONSULTANDO : rotuloBotao}
      </button>
      <div aria-live="polite">
        {estado.tipo === 'ERRO' && <p>{estado.mensagem}</p>}
        {estado.tipo === 'PRONTA' && (
          <>
            <p>
              <strong>{MENSAGENS_ORC.SELO_IA}</strong>
            </p>
            {children(estado.valor)}
          </>
        )}
      </div>
    </section>
  );
}
