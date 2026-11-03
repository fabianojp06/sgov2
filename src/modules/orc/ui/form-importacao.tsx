'use client';

import { useActionState } from 'react';
import type { ErroCampo, Resultado } from '@/shared/kernel';

// Importação da planilha-modelo (US-121): arquivo .xlsx, relatório de erros por linha (nada é
// gravado com erro) e, no sucesso, o resumo por CC. Componente cliente: a ação vem por props.
export type ResumoImportacaoTela = { mensagem: string; porCc: readonly { cc: string; posicoes: number; pacotes: number; total: string }[] };
export type AcaoImportacao = (dados: FormData) => Promise<Resultado<ResumoImportacaoTela>>;

const LINHA = /^linhas\.([^.]+)\.(\d+)\.(.*)$/;

export function separarErros(erros: readonly ErroCampo[]) {
  const gerais: string[] = [];
  const porLinha: { aba: string; linha: number; coluna: string; mensagem: string }[] = [];
  for (const e of erros) {
    const m = LINHA.exec(e.campo);
    if (m) porLinha.push({ aba: m[1]!, linha: Number(m[2]), coluna: m[3] === '_' ? '' : m[3]!, mensagem: e.mensagem });
    else gerais.push(e.mensagem);
  }
  return { gerais, porLinha };
}

export function FormImportacao({ exercicioId, importar }: { exercicioId: string; importar: AcaoImportacao }) {
  const [estado, enviar, pendente] = useActionState((_anterior: Resultado<ResumoImportacaoTela> | null, dados: FormData) => importar(dados), null);
  // Durante o envio as regiões vivas ficam vazias: a mesma frase de novo é anunciada outra vez.
  const erros = estado && !estado.ok && !pendente ? separarErros(estado.erros) : null;
  const sucesso = estado?.ok && !pendente ? estado.valor : null;
  return (
    <>
      <form action={enviar} aria-busy={pendente}>
        <input type="hidden" name="exercicioId" value={exercicioId} />
        <p>
          <label htmlFor="importacao-arquivo">Planilha (layout ADMC-ORC v1.0)</label>
          <input id="importacao-arquivo" name="arquivo" type="file" accept=".xlsx" required />
        </p>
        <button type="submit" disabled={pendente}>
          {pendente ? 'Importando…' : 'Importar'}
        </button>
      </form>
      {/* A região viva fica sempre montada e só com a frase; o resumo vem fora dela. */}
      <div role="status">{sucesso && <p>{sucesso.mensagem}</p>}</div>
      {sucesso && (
        <table>
          <caption>Resumo por centro de custo</caption>
          <thead>
            <tr>
              <th scope="col">CC</th>
              <th scope="col">Posições</th>
              <th scope="col">Pacotes</th>
              <th scope="col">Total calculado (R$)</th>
            </tr>
          </thead>
          <tbody>
            {sucesso.porCc.map((c) => (
              <tr key={c.cc}>
                <th scope="row">{c.cc}</th>
                <td>{c.posicoes}</td>
                <td>{c.pacotes}</td>
                <td>{c.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {erros && (
        <>
          {/* Só a frase vai à região viva; a tabela (até 500 linhas) fica fora, para o leitor de tela não ler tudo. */}
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
                  <th scope="col">Aba</th>
                  <th scope="col">Linha</th>
                  <th scope="col">Coluna</th>
                  <th scope="col">Erro</th>
                </tr>
              </thead>
              <tbody>
                {erros.porLinha.map((e, i) => (
                  <tr key={i}>
                    <th scope="row">{e.aba}</th>
                    <td>{e.linha}</td>
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
