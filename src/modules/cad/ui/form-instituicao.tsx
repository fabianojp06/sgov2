'use client';

import { useState, useTransition } from 'react';
import type { ErroCampo } from '@/shared/kernel';
import { TAMANHO_NOME_EXIBICAO } from '../domain/instituicao';
import { MSG_SO_CONSULTA } from './form-parametros';

// Nome de exibição da instituição (#434; spec §6.7). O valor que a tela mostrava vai junto, para a
// gravação concorrente ser recusada; depois de salvar, ele passa a ser o valor gravado.

type Resposta = { ok: true; valor: { nome: string } } | { ok: false; erros: readonly ErroCampo[] };

export function FormInstituicao({
  nome: nomeInicial,
  podeAlterar,
  alterar,
}: {
  nome: string;
  podeAlterar: boolean;
  alterar: (e: { nome: string; anterior: string }) => Promise<Resposta>;
}) {
  const [nome, setNome] = useState(nomeInicial);
  const [anterior, setAnterior] = useState(nomeInicial);
  const [erros, setErros] = useState<readonly ErroCampo[]>([]);
  const [salvo, setSalvo] = useState(false);
  const [salvando, iniciar] = useTransition();
  const erroCampo = erros.filter((e) => e.campo === 'nome').map((e) => e.mensagem).join(' ');
  const gerais = erros.filter((e) => e.campo !== 'nome');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => {
          setSalvo(false);
          try {
            const r = await alterar({ nome, anterior });
            if (r.ok) {
              setAnterior(r.valor.nome);
              setNome(r.valor.nome);
              setErros([]);
              setSalvo(true);
            } else {
              setErros(r.erros);
            }
          } catch {
            setErros([{ campo: '_', mensagem: 'Não foi possível salvar. Confira a conexão e tente de novo.' }]);
          }
        });
      }}
      aria-busy={salvando}
      noValidate
    >
      {gerais.length > 0 && (
        <ul role="alert">
          {gerais.map((e, i) => (
            <li key={i}>{e.mensagem}</li>
          ))}
        </ul>
      )}
      <p role="status">{salvo ? 'Nome de exibição salvo.' : ''}</p>
      {!podeAlterar && <p>{MSG_SO_CONSULTA}</p>}
      <fieldset disabled={!podeAlterar}>
        <legend>Instituição</legend>
        <label htmlFor="nome-exibicao">Nome de exibição</label>{' '}
        <input
          id="nome-exibicao"
          value={nome}
          maxLength={TAMANHO_NOME_EXIBICAO}
          onChange={(e) => setNome(e.target.value)}
          aria-describedby={erroCampo ? 'nome-exibicao-ajuda nome-exibicao-erro' : 'nome-exibicao-ajuda'}
          {...(erroCampo ? { 'aria-invalid': true } : {})}
        />
        <p id="nome-exibicao-ajuda">
          Aparece nas telas e no cabeçalho dos e-mails. Até {TAMANHO_NOME_EXIBICAO} caracteres. Em branco, o sistema mostra só &quot;SGO&quot;.
        </p>
        {erroCampo && (
          <span id="nome-exibicao-erro" role="alert">
            {erroCampo}
          </span>
        )}
      </fieldset>
      {podeAlterar && (
        <button type="submit" disabled={salvando}>
          Salvar
        </button>
      )}
    </form>
  );
}
