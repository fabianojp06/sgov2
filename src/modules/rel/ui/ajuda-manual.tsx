'use client';

import { useRef, useState } from 'react';
import type { ErroCampo } from '@/shared/kernel';
import { MAXIMO_PERGUNTA, type AjudaManual } from '../domain/ajuda-manual';

// Pergunta ao manual (US-108): campo, espera, erro e a resposta com o selo "Gerado com IA – revisar"
// (spec §6.8, princípio 3) e os trechos citados, com o texto do manual como está no catálogo e o link
// para a tela. Componente cliente: recebe a Server Action por props; nada aqui chama a IA.

export type RespostaAjudaTela = { ok: true; valor: AjudaManual } | { ok: false; erros: readonly ErroCampo[] };
export type EstadoAjuda = { tipo: 'OCIOSO' } | { tipo: 'CONSULTANDO' } | { tipo: 'ERRO'; mensagem: string } | { tipo: 'PRONTA'; valor: AjudaManual };

export const TEXTOS_AJUDA = {
  TITULO: 'Pergunte ao manual',
  ROTULO: 'Como faço…?',
  AVISO: 'A IA responde só com o manual do seu perfil e mostra os trechos em que se baseou. Não escreva nomes de pessoas nem dados pessoais na pergunta.',
  BOTAO: 'Perguntar',
  CONSULTANDO: 'Consultando a IA…',
  SELO: 'Gerado com IA – revisar',
  NAO_ENCONTROU: 'O manual do seu perfil não responde a esta pergunta. Veja o sumário abaixo ou contate o Administrador.',
  TRECHOS: 'Trechos do manual',
  FALHA: 'Não foi possível consultar a IA. Verifique a conexão e tente de novo.',
} as const;

export function estadoDaResposta(r: RespostaAjudaTela): EstadoAjuda {
  return r.ok ? { tipo: 'PRONTA', valor: r.valor } : { tipo: 'ERRO', mensagem: r.erros.map((e) => e.mensagem).join(' ') };
}

/** O conteúdo da região viva, por estado (puro: testável sem DOM). */
export function ConteudoAjuda({ estado }: { estado: EstadoAjuda }) {
  switch (estado.tipo) {
    case 'CONSULTANDO':
      return <p>{TEXTOS_AJUDA.CONSULTANDO}</p>;
    case 'ERRO':
      return <p>{estado.mensagem}</p>;
    case 'PRONTA':
      if (!estado.valor.encontrou) return <p>{TEXTOS_AJUDA.NAO_ENCONTROU}</p>;
      return (
        <>
          <p>
            <strong>{TEXTOS_AJUDA.SELO}</strong>
          </p>
          <p>{estado.valor.resposta}</p>
          <h3>{TEXTOS_AJUDA.TRECHOS}</h3>
          <ul>
            {estado.valor.trechos.map((t) => (
              <li key={t.id}>
                <a href={t.rota}>{t.nome}</a> ({t.local})<blockquote>{t.texto}</blockquote>
              </li>
            ))}
          </ul>
        </>
      );
    default:
      return null;
  }
}

export function AjudaManualIA({ perguntar }: { perguntar: (entrada: { pergunta: string }) => Promise<RespostaAjudaTela> }) {
  const [estado, setEstado] = useState<EstadoAjuda>({ tipo: 'OCIOSO' });
  const [pergunta, setPergunta] = useState('');
  // Ref, e não só o estado: dois envios seguidos não disparam duas consultas.
  const ocupado = useRef(false);
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (ocupado.current) return;
    ocupado.current = true;
    setEstado({ tipo: 'CONSULTANDO' });
    try {
      setEstado(estadoDaResposta(await perguntar({ pergunta })));
    } catch {
      setEstado({ tipo: 'ERRO', mensagem: TEXTOS_AJUDA.FALHA });
    } finally {
      ocupado.current = false;
    }
  };
  return (
    <section aria-labelledby="ajuda-ia-titulo">
      <h2 id="ajuda-ia-titulo">{TEXTOS_AJUDA.TITULO}</h2>
      <form onSubmit={enviar}>
        <p>
          <label htmlFor="ajuda-ia-pergunta">{TEXTOS_AJUDA.ROTULO}</label>
          <textarea
            id="ajuda-ia-pergunta"
            name="pergunta"
            rows={2}
            maxLength={MAXIMO_PERGUNTA}
            value={pergunta}
            onChange={(e) => setPergunta(e.target.value)}
            aria-describedby="ajuda-ia-aviso"
          />
        </p>
        <p role="note" id="ajuda-ia-aviso">
          {TEXTOS_AJUDA.AVISO}
        </p>
        {/* aria-disabled, e não disabled, para o foco ficar no botão durante a consulta. */}
        <button type="submit" aria-disabled={estado.tipo === 'CONSULTANDO'}>
          {TEXTOS_AJUDA.BOTAO}
        </button>
      </form>
      <div role="status" aria-live="polite">
        <ConteudoAjuda estado={estado} />
      </div>
    </section>
  );
}
