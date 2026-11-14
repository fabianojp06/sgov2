'use client';

import { useRef, useState, useTransition } from 'react';
import type { ErroCampo } from '@/shared/kernel';
import { DESCRICAO_GRAFICO, MAXIMO_TEMA, type Roteiro } from '../domain/apresentacao';

// Roteiro de apresentação (US-105): o tema, a espera, o roteiro com o selo "Gerado com IA – revisar" e o
// botão de baixar os slides em PDF (o roteiro volta ao servidor, que relê os dados e desenha os gráficos).
// Componente cliente: recebe as Server Actions por props.

type Resposta<T> = { ok: true; valor: T } | { ok: false; erros: readonly ErroCampo[] };
type Gerado = { tema: string; roteiro: Roteiro };

export const TEXTOS_APRESENTACAO = {
  ROTULO: 'Tema da apresentação',
  AVISO:
    'A IA usa só os dados consolidados da Administração Central e dos TPs (agregados, sem nomes nem salários) e escolhe os gráficos de uma lista do sistema. ' +
    'Não escreva dados pessoais no tema.',
  GERAR: 'Montar roteiro com IA',
  GERANDO: 'Montando o roteiro com a IA… pode levar até um minuto e meio.',
  PRONTO: 'Roteiro pronto.',
  SELO: 'Gerado com IA – revisar',
  BAIXAR: 'Baixar os slides em PDF',
  BAIXANDO: 'Gerando o PDF…',
  FALHA: 'Não foi possível concluir. Confira a conexão e tente de novo.',
} as const;

const baixar = (nome: string, base64: string) => {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
};

/** O roteiro (puro: testável sem DOM). */
export function ConteudoRoteiro({ gerado }: { gerado: Gerado }) {
  return (
    <>
      <p>
        <strong>{TEXTOS_APRESENTACAO.SELO}</strong>
      </p>
      <ol>
        {gerado.roteiro.slides.map((s, i) => (
          <li key={i}>
            <h3>{s.titulo}</h3>
            {s.topicos.length > 0 && (
              <ul>
                {s.topicos.map((t, j) => (
                  <li key={j}>{t}</li>
                ))}
              </ul>
            )}
            {s.grafico !== 'NENHUM' && <p>Gráfico: {DESCRICAO_GRAFICO[s.grafico]}.</p>}
            {s.notas && <p>Notas do apresentador: {s.notas}</p>}
          </li>
        ))}
      </ol>
    </>
  );
}

export function Apresentacao({
  gerar,
  exportar,
  podeExportar,
}: {
  gerar: (e: { tema: string }) => Promise<Resposta<Gerado>>;
  exportar: (e: Gerado) => Promise<Resposta<{ nome: string; base64: string }>>;
  podeExportar: boolean;
}) {
  const [tema, setTema] = useState('');
  const [gerado, setGerado] = useState<Gerado | null>(null);
  const [erros, setErros] = useState<readonly ErroCampo[]>([]);
  const [aviso, setAviso] = useState('');
  const [pendente, iniciar] = useTransition();
  // Ref, e não só o estado: dois cliques seguidos não disparam duas chamadas.
  const ocupado = useRef(false);
  const executar = (antes: string, chamada: () => Promise<void>) => {
    if (ocupado.current) return;
    ocupado.current = true;
    setErros([]);
    setAviso(antes);
    iniciar(async () => {
      try {
        await chamada();
      } catch {
        setAviso('');
        setErros([{ campo: '_', mensagem: TEXTOS_APRESENTACAO.FALHA }]);
      } finally {
        ocupado.current = false;
      }
    });
  };
  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    executar(TEXTOS_APRESENTACAO.GERANDO, async () => {
      const r = await gerar({ tema });
      if (r.ok) {
        setGerado(r.valor);
        setAviso(TEXTOS_APRESENTACAO.PRONTO);
      } else {
        setAviso('');
        setErros(r.erros);
      }
    });
  };
  const baixarSlides = () =>
    gerado &&
    executar(TEXTOS_APRESENTACAO.BAIXANDO, async () => {
      const r = await exportar(gerado);
      setAviso('');
      if (r.ok) baixar(r.valor.nome, r.valor.base64);
      else setErros(r.erros);
    });
  const erroTema = erros.filter((e) => e.campo === 'tema').map((e) => e.mensagem).join(' ');
  const erroGeral = erros.filter((e) => e.campo !== 'tema').map((e) => e.mensagem).join(' ');
  return (
    <section aria-labelledby="apresentacao-titulo">
      <h2 id="apresentacao-titulo">{TEXTOS_APRESENTACAO.GERAR}</h2>
      <form onSubmit={enviar}>
        <p>
          <label htmlFor="apresentacao-tema">{TEXTOS_APRESENTACAO.ROTULO}</label>
          <textarea
            id="apresentacao-tema"
            rows={2}
            maxLength={MAXIMO_TEMA}
            value={tema}
            onChange={(e) => setTema(e.target.value)}
            aria-invalid={erroTema ? true : undefined}
            aria-describedby={erroTema ? 'apresentacao-aviso apresentacao-erro-tema' : 'apresentacao-aviso'}
          />
        </p>
        <p role="note" id="apresentacao-aviso">
          {TEXTOS_APRESENTACAO.AVISO}
        </p>
        {erroTema && (
          <p id="apresentacao-erro-tema" role="alert">
            {erroTema}
          </p>
        )}
        {/* aria-disabled, e não disabled, para o foco ficar no botão durante a geração. */}
        <button type="submit" aria-disabled={pendente}>
          {TEXTOS_APRESENTACAO.GERAR}
        </button>
      </form>
      <p role="status" aria-live="polite">
        {aviso}
      </p>
      {erroGeral && <p role="alert">{erroGeral}</p>}
      {gerado && (
        <section aria-labelledby="apresentacao-roteiro">
          <h2 id="apresentacao-roteiro">Roteiro: {gerado.tema}</h2>
          {podeExportar && (
            <button type="button" onClick={baixarSlides} aria-disabled={pendente}>
              {TEXTOS_APRESENTACAO.BAIXAR}
            </button>
          )}
          <ConteudoRoteiro gerado={gerado} />
        </section>
      )}
    </section>
  );
}
