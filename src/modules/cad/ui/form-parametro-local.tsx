'use client';

import { useState, useTransition } from 'react';
import type { ParametroLocalTela } from '../application/parametros-locais-conta';
import { NATUREZAS_CONTA } from '../domain/parametro-local-conta';
import { MSG_SO_CONSULTA } from './form-parametros';
import { depoisDeSalvar, type EstadoSalvar, type RespostaSalvar } from './form-parametros-logica';

// Parâmetros locais de uma conta analítica (US-045): natureza OPEX/CAPEX e, se marcado, faixas do
// semáforo próprias; sem elas, valem as do exercício. Sem a permissão, só leitura.

type Entrada = {
  contaId: string;
  versao: number;
  natureza: string | null;
  semaforo: { verdeAte: string; amareloAte: string; laranjaAte: string } | null;
};

const FAIXAS = [
  ['verdeAte', 'Verde até (%)'],
  ['amareloAte', 'Amarelo até (%)'],
  ['laranjaAte', 'Laranja até (%)'],
] as const;

export function FormParametroLocal({
  conta,
  faixasExercicio,
  podeAlterar,
  alterar,
}: {
  conta: ParametroLocalTela;
  /** As faixas do exercício mais recente, para o padrão do formulário e o texto de ajuda. */
  faixasExercicio: { verdeAte: string; amareloAte: string; laranjaAte: string } | null;
  podeAlterar: boolean;
  alterar: (e: Entrada) => Promise<RespostaSalvar>;
}) {
  const [natureza, setNatureza] = useState(conta.natureza ?? '');
  const [proprias, setProprias] = useState(conta.semaforo !== null);
  const [faixas, setFaixas] = useState(conta.semaforo ?? faixasExercicio ?? { verdeAte: '70', amareloAte: '85', laranjaAte: '95' });
  // Valores em pt-BR (vírgula decimal); o domínio aceita vírgula ou ponto.
  const [estado, setEstado] = useState<EstadoSalvar>({ versao: conta.versao, erros: [], salvo: false });
  const [salvando, iniciar] = useTransition();
  const erroDe = (campo: string) => estado.erros.filter((e) => e.campo === campo).map((e) => e.mensagem).join(' ');
  const exibidos = new Set(['natureza', 'semaforo', ...FAIXAS.map(([c]) => `semaforo.${c}`)]);
  const gerais = estado.erros.filter((e) => !exibidos.has(e.campo));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => {
          setEstado((antes) => ({ ...antes, salvo: false }));
          try {
            const r = await alterar({ contaId: conta.contaId, versao: estado.versao, natureza: natureza || null, semaforo: proprias ? faixas : null });
            setEstado((antes) => depoisDeSalvar(antes, r));
          } catch {
            setEstado((antes) => ({ ...antes, salvo: false, erros: [{ campo: '_', mensagem: 'Não foi possível salvar. Confira a conexão e tente de novo.' }] }));
          }
        });
      }}
      aria-busy={salvando}
      noValidate
    >
      <h2>
        {conta.classificacao} {conta.descricao}
      </h2>
      {gerais.length > 0 && (
        <ul role="alert">
          {gerais.map((e, i) => (
            <li key={i}>{e.mensagem}</li>
          ))}
        </ul>
      )}
      <p role="status">{estado.salvo ? `Parâmetros da conta ${conta.classificacao} salvos.` : ''}</p>
      {!podeAlterar && <p>{MSG_SO_CONSULTA}</p>}
      <fieldset disabled={!podeAlterar}>
        <legend>Parâmetros locais</legend>
        <label htmlFor="natureza">Natureza</label>{' '}
        <select
          id="natureza"
          value={natureza}
          onChange={(e) => setNatureza(e.target.value)}
          {...(erroDe('natureza') ? { 'aria-invalid': true, 'aria-describedby': 'natureza-erro' } : {})}
        >
          <option value="">Não definida</option>
          {NATUREZAS_CONTA.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        {erroDe('natureza') && (
          <span id="natureza-erro" role="alert">
            {erroDe('natureza')}
          </span>
        )}
        <p>
          <label>
            <input type="checkbox" checked={proprias} onChange={(e) => setProprias(e.target.checked)} /> Faixas do semáforo próprias desta conta
          </label>
        </p>
        {!proprias && (
          <p>
            Usa as faixas do exercício
            {faixasExercicio ? ` (verde até ${faixasExercicio.verdeAte}%, amarelo até ${faixasExercicio.amareloAte}%, laranja até ${faixasExercicio.laranjaAte}%)` : ''}.
          </p>
        )}
        {proprias &&
          FAIXAS.map(([campo, rotulo]) => {
            const erro = erroDe(`semaforo.${campo}`);
            // O erro de ordem (campo 'semaforo') vale para as três faixas.
            const descritores = [erro ? `faixa-${campo}-erro` : '', erroDe('semaforo') ? 'semaforo-erro' : ''].filter(Boolean).join(' ');
            return (
              <p key={campo}>
                <label htmlFor={`faixa-${campo}`}>{rotulo}</label>{' '}
                <input
                  id={`faixa-${campo}`}
                  value={faixas[campo]}
                  inputMode="decimal"
                  onChange={(e) => setFaixas((f) => ({ ...f, [campo]: e.target.value }))}
                  {...(descritores ? { 'aria-invalid': true, 'aria-describedby': descritores } : {})}
                />
                {erro && (
                  <span id={`faixa-${campo}-erro`} role="alert">
                    {erro}
                  </span>
                )}
              </p>
            );
          })}
        {proprias && erroDe('semaforo') && (
          <p id="semaforo-erro" role="alert">
            {erroDe('semaforo')}
          </p>
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
