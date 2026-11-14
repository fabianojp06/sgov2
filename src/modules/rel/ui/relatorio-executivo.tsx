'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { AcaoConfirmada, type AcaoFormulario } from '@/modules/ger';
import type { ErroCampo } from '@/shared/kernel';
import { MAXIMO_ITENS_RELATORIO, MAXIMO_RESUMO_RELATORIO, type TextosRelatorio } from '../domain/relatorio-executivo';

// Relatório executivo mensal (US-103): o formulário de gerar o rascunho (IA) e o de editar os textos.
// Componentes cliente: recebem as Server Actions por props. Aprovar (AcaoConfirmada do C3) fica no formulário
// e some enquanto houver alteração não salva (revisão 12.12: aprovaria o texto antigo, que fica imutável).

type Resposta<T> = { ok: true; valor: T } | { ok: false; erros: readonly ErroCampo[] };
const FALHA = 'Não foi possível concluir. Confira a conexão e tente de novo.';
const mensagens = (erros: readonly ErroCampo[], campo: string) =>
  erros
    .filter((e) => e.campo === campo)
    .map((e) => e.mensagem)
    .join(' ');

export const TEXTOS_RELATORIO = {
  GERAR: 'Gerar rascunho com IA',
  GERANDO: 'Gerando o rascunho com a IA… pode levar até um minuto e meio.',
  AVISO_GERAR:
    'A IA recebe só os indicadores agregados do mês (Administração Central e TPs, sem nomes nem salários) e redige resumo, riscos e recomendações. ' +
    'Gerar de novo substitui o rascunho do mês; o aprovado não muda.',
  SALVAR: 'Salvar textos',
  SALVO: 'Textos salvos.',
  UM_POR_LINHA: `Um item por linha, até ${MAXIMO_ITENS_RELATORIO}.`,
  SALVE_ANTES: 'Salve os textos antes de aprovar.',
  PERGUNTA_APROVAR: 'Deseja realmente aprovar este relatório? Depois de aprovado, ele não pode mais ser alterado.',
  CARACTERES: (n: number) => `${n} de ${MAXIMO_RESUMO_RELATORIO} caracteres.`,
} as const;

export function GerarRascunho({ mesAtual, gerar }: { mesAtual: string; gerar: (e: { mes: string }) => Promise<Resposta<{ id: string; mes: string }>> }) {
  const router = useRouter();
  const [mes, setMes] = useState(mesAtual);
  const [erros, setErros] = useState<readonly ErroCampo[]>([]);
  const [pendente, iniciar] = useTransition();
  // Ref, e não só o estado: dois cliques seguidos não disparam duas gerações.
  const ocupado = useRef(false);
  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    if (ocupado.current) return;
    ocupado.current = true;
    setErros([]);
    iniciar(async () => {
      try {
        const r = await gerar({ mes });
        if (r.ok) router.push(`/rel/relatorio-executivo/${r.valor.id}`);
        else setErros(r.erros);
      } catch {
        setErros([{ campo: '_', mensagem: FALHA }]);
      } finally {
        ocupado.current = false;
      }
    });
  };
  const erroMes = mensagens(erros, 'mes');
  const erroGeral = mensagens(erros, '_');
  return (
    <form onSubmit={enviar} aria-labelledby="gerar-relatorio-titulo">
      <h2 id="gerar-relatorio-titulo">{TEXTOS_RELATORIO.GERAR}</h2>
      <p role="note" id="gerar-relatorio-aviso">
        {TEXTOS_RELATORIO.AVISO_GERAR}
      </p>
      <p>
        <label htmlFor="gerar-relatorio-mes">Mês</label>{' '}
        <input
          id="gerar-relatorio-mes"
          type="month"
          value={mes}
          max={mesAtual}
          onChange={(e) => setMes(e.target.value)}
          aria-invalid={erroMes ? true : undefined}
          aria-describedby={erroMes ? 'gerar-relatorio-aviso gerar-relatorio-erro-mes' : 'gerar-relatorio-aviso'}
        />{' '}
        {/* aria-disabled, e não disabled, para o foco ficar no botão durante a geração. */}
        <button type="submit" aria-disabled={pendente}>
          {TEXTOS_RELATORIO.GERAR}
        </button>
      </p>
      {erroMes && (
        <p id="gerar-relatorio-erro-mes" role="alert">
          {erroMes}
        </p>
      )}
      <p role="status" aria-live="polite">
        {pendente ? TEXTOS_RELATORIO.GERANDO : ''}
      </p>
      {erroGeral && <p role="alert">{erroGeral}</p>}
    </form>
  );
}

export function EditarTextos({
  id,
  mes,
  versao,
  textos,
  salvar,
  aprovar,
}: {
  id: string;
  mes: string;
  versao: number;
  textos: TextosRelatorio;
  salvar: (e: { id: string; versao: number; resumo: string; riscos: string; recomendacoes: string }) => Promise<Resposta<{ versao: number }>>;
  /** Com a permissão de aprovar; sem ela, o botão não aparece. */
  aprovar?: AcaoFormulario | undefined;
}) {
  const router = useRouter();
  const [resumo, setResumo] = useState(textos.resumo);
  const [riscos, setRiscos] = useState(textos.riscos.join('\n'));
  const [recomendacoes, setRecomendacoes] = useState(textos.recomendacoes.join('\n'));
  const [erros, setErros] = useState<readonly ErroCampo[]>([]);
  const [salvo, setSalvo] = useState(false);
  const [pendente, iniciar] = useTransition();
  const formulario = useRef<HTMLFormElement>(null);
  const alterado = resumo !== textos.resumo || riscos !== textos.riscos.join('\n') || recomendacoes !== textos.recomendacoes.join('\n');
  // Com erro de campo, o foco vai ao primeiro campo inválido.
  useEffect(() => {
    if (erros.length > 0) formulario.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [erros]);
  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    if (pendente) return;
    setErros([]);
    setSalvo(false);
    iniciar(async () => {
      try {
        const r = await salvar({ id, versao, resumo, riscos, recomendacoes });
        if (r.ok) {
          setSalvo(true);
          router.refresh();
        } else setErros(r.erros);
      } catch {
        setErros([{ campo: '_', mensagem: FALHA }]);
      }
    });
  };
  const campo = (nome: 'resumo' | 'riscos' | 'recomendacoes', rotulo: string, valor: string, mudar: (v: string) => void, dica?: string) => {
    const erro = mensagens(erros, nome);
    const contador = nome === 'resumo' ? 'relatorio-resumo-contador' : '';
    const ids = [dica ? `relatorio-${nome}-dica` : '', contador, erro ? `relatorio-${nome}-erro` : ''].filter(Boolean).join(' ');
    return (
      <p>
        <label htmlFor={`relatorio-${nome}`}>{rotulo}</label>
        <textarea
          id={`relatorio-${nome}`}
          rows={nome === 'resumo' ? 6 : 5}
          maxLength={nome === 'resumo' ? MAXIMO_RESUMO_RELATORIO : undefined}
          value={valor}
          onChange={(e) => mudar(e.target.value)}
          aria-invalid={erro ? true : undefined}
          aria-describedby={ids || undefined}
        />
        {dica && <span id={`relatorio-${nome}-dica`}>{dica}</span>}
        {contador && <span id={contador}>{TEXTOS_RELATORIO.CARACTERES([...valor].length)}</span>}
        {erro && (
          <span id={`relatorio-${nome}-erro`} role="alert">
            {erro}
          </span>
        )}
      </p>
    );
  };
  const erroGeral = mensagens(erros, '_');
  return (
    <form ref={formulario} onSubmit={enviar} aria-labelledby="editar-relatorio-titulo">
      <h2 id="editar-relatorio-titulo">Revisar os textos</h2>
      {campo('resumo', 'Resumo', resumo, setResumo)}
      {campo('riscos', 'Riscos', riscos, setRiscos, TEXTOS_RELATORIO.UM_POR_LINHA)}
      {campo('recomendacoes', 'Recomendações', recomendacoes, setRecomendacoes, TEXTOS_RELATORIO.UM_POR_LINHA)}
      <button type="submit" aria-disabled={pendente}>
        {TEXTOS_RELATORIO.SALVAR}
      </button>
      <p role="status" aria-live="polite">
        {salvo ? TEXTOS_RELATORIO.SALVO : ''}
      </p>
      {erroGeral && <p role="alert">{erroGeral}</p>}
      {aprovar &&
        (alterado ? (
          <p role="note">{TEXTOS_RELATORIO.SALVE_ANTES}</p>
        ) : (
          <AcaoConfirmada rotulo="Aprovar" contexto={`o relatório de ${mes}`} pergunta={TEXTOS_RELATORIO.PERGUNTA_APROVAR} acao={aprovar} campos={{ id, versao: String(versao) }} />
        ))}
    </form>
  );
}
