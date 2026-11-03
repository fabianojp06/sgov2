'use client';

import { useState, useTransition } from 'react';
import { MSG_SO_CONSULTA, mensagemCongelado } from './form-parametros';
import { depoisDeSalvar, type EstadoSalvar, type RespostaSalvar } from './form-parametros-logica';

// Salário mínimo nacional do exercício (US-053 parte 2; RN_CAR_11, base da insalubridade). Valor como
// texto (ponto ou vírgula decimal); com o ano congelado ou sem a permissão de alterar, só leitura.

export function FormSalarioMinimo({
  ano,
  versao: versaoInicial,
  valor: valorInicial,
  congelado,
  podeAlterar,
  alterar,
}: {
  ano: number;
  versao: number;
  valor: string | null;
  congelado: boolean;
  podeAlterar: boolean;
  alterar: (e: { ano: number; versao: number; valor: string }) => Promise<RespostaSalvar>;
}) {
  const [valor, setValor] = useState(valorInicial ?? '');
  const [estado, setEstado] = useState<EstadoSalvar>({ versao: versaoInicial, erros: [], salvo: false });
  const { erros, salvo } = estado;
  const [salvando, iniciar] = useTransition();
  const bloqueado = congelado || !podeAlterar;
  const erroCampo = erros.filter((e) => e.campo === 'salarioMinimo').map((e) => e.mensagem).join(' ');
  const gerais = erros.filter((e) => e.campo !== 'salarioMinimo');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => {
          setEstado((antes) => ({ ...antes, salvo: false }));
          try {
            const r = await alterar({ ano, versao: estado.versao, valor });
            setEstado((antes) => depoisDeSalvar(antes, r));
          } catch {
            setEstado((antes) => ({ ...antes, salvo: false, erros: [{ campo: '_', mensagem: 'Não foi possível salvar. Confira a conexão e tente de novo.' }] }));
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
      <p role="status">{salvo ? `Salário mínimo de ${ano} salvo.` : ''}</p>
      {congelado && <p>{mensagemCongelado(ano)}</p>}
      {!congelado && !podeAlterar && <p>{MSG_SO_CONSULTA}</p>}
      <fieldset disabled={bloqueado}>
        <legend>Salário mínimo nacional de {ano}</legend>
        <label htmlFor="salario-minimo">Valor (R$)</label>{' '}
        <input
          id="salario-minimo"
          value={valor}
          inputMode="decimal"
          onChange={(e) => setValor(e.target.value)}
          {...(erroCampo ? { 'aria-invalid': true, 'aria-describedby': 'salario-minimo-erro' } : {})}
        />
        {erroCampo && (
          <span id="salario-minimo-erro" role="alert">
            {erroCampo}
          </span>
        )}
        {valorInicial === null && <p>Ainda não informado para este exercício.</p>}
      </fieldset>
      {!bloqueado && (
        <button type="submit" disabled={salvando}>
          Salvar
        </button>
      )}
    </form>
  );
}
