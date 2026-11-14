'use client';

import { useActionState } from 'react';
import type { Resultado } from '@/shared/kernel';
import { separarErros } from './form-importacao';

// Carga do realizado (US-085, parte 1; plano do P32, Task 3): arquivo .xlsx no layout PROVISÓRIO (D-P32-1), relatório
// de erros por linha (nada é gravado com erro) e, no sucesso, o resumo. E o fechamento da competência (D-P32-4).
// Componentes cliente: as ações vêm por props.
export type AcaoRealizado = (dados: FormData) => Promise<Resultado<{ mensagem: string }>>;

export function FormCargaRealizado({ propostaId, carregar }: { propostaId: string; carregar: AcaoRealizado }) {
  const [estado, enviar, pendente] = useActionState((_a: Resultado<{ mensagem: string }> | null, dados: FormData) => carregar(dados), null);
  const erros = estado && !estado.ok && !pendente ? separarErros(estado.erros.map((e) => ({ ...e, campo: e.campo.replace(/^linhas\./, 'linhas.Realizado.') }))) : null;
  return (
    <>
      <form action={enviar} aria-busy={pendente}>
        <input type="hidden" name="propostaId" value={propostaId} />
        <p>
          <label htmlFor="realizado-arquivo">Arquivo do realizado (.xlsx, aba Realizado: Conta, Competência e Valor)</label>
          <input id="realizado-arquivo" name="arquivo" type="file" accept=".xlsx" required />
        </p>
        <button type="submit" disabled={pendente}>
          {pendente ? 'Carregando…' : 'Carregar realizado'}
        </button>
      </form>
      <div role="status">{estado?.ok && !pendente && <p>{estado.valor.mensagem}</p>}</div>
      {erros && (
        <>
          <div role="alert">
            {erros.gerais.map((m, i) => (
              <p key={i}>{m}</p>
            ))}
          </div>
          {erros.porLinha.length > 0 && (
            <table>
              <caption>{`Erros por linha (${erros.porLinha.length})`}</caption>
              <thead>
                <tr>
                  <th scope="col">Linha</th>
                  <th scope="col">Coluna</th>
                  <th scope="col">Erro</th>
                </tr>
              </thead>
              <tbody>
                {erros.porLinha.map((e, i) => (
                  <tr key={i}>
                    <th scope="row">{e.linha}</th>
                    <td>{e.coluna}</td>
                    <td>{e.mensagem}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
  );
}

export function FormFecharCompetencia({ fechar }: { fechar: AcaoRealizado }) {
  const [estado, enviar, pendente] = useActionState((_a: Resultado<{ mensagem: string }> | null, dados: FormData) => fechar(dados), null);
  return (
    <form action={enviar} aria-busy={pendente}>
      <p>
        <label htmlFor="realizado-competencia">Competência a fechar (AAAA-MM)</label>
        <input id="realizado-competencia" name="competencia" type="month" required />{' '}
        <button type="submit" disabled={pendente}>
          {pendente ? 'Fechando…' : 'Fechar competência'}
        </button>
      </p>
      <p role="note">O fechamento vale para todos os Termos de Parceria e não pode ser desfeito.</p>
      <div role="status">{estado?.ok && !pendente && <p>{estado.valor.mensagem}</p>}</div>
      <div role="alert">{estado && !estado.ok && !pendente && estado.erros.map((e, i) => <p key={i}>{e.mensagem}</p>)}</div>
    </form>
  );
}

/** Reprocessar as pendências depois da Integração 1 (US-085, parte 2; D-P32-12). */
export function FormReprocessarPendencias({ propostaId, reprocessar }: { propostaId: string; reprocessar: AcaoRealizado }) {
  const [estado, enviar, pendente] = useActionState((_a: Resultado<{ mensagem: string }> | null, dados: FormData) => reprocessar(dados), null);
  return (
    <form action={enviar} aria-busy={pendente}>
      <input type="hidden" name="propostaId" value={propostaId} />
      <button type="submit" disabled={pendente}>
        {pendente ? 'Reprocessando…' : 'Reprocessar pendências'}
      </button>
      <div role="status">{estado?.ok && !pendente && <p>{estado.valor.mensagem}</p>}</div>
      <div role="alert">{estado && !estado.ok && !pendente && estado.erros.map((e, i) => <p key={i}>{e.mensagem}</p>)}</div>
    </form>
  );
}
