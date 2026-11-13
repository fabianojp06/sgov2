'use client';

import { useState, useTransition } from 'react';
import type { ErroCampo } from '@/shared/kernel';
import type { UnidadeParaVinculo } from '../application/vinculo-cargo';
import { MSG_SO_CONSULTA } from './form-parametros';

// Vínculo do cargo com a estrutura funcional (US-048 parte 2; RN_CAR_08, RN_EST_05): a unidade
// analítica do cargo. Sem vínculo (ou com a unidade inativada), o cargo fica "pendente de alocação".

type Resposta = { ok: true; valor: { unidadeId: string | null } } | { ok: false; erros: readonly ErroCampo[] };

export function FormVinculoCargo({
  cargoId,
  lotacao,
  unidades,
  podeAlterar,
  vincular,
}: {
  cargoId: string;
  lotacao: { id: string; rotulo: string; ativa: boolean } | null;
  unidades: readonly UnidadeParaVinculo[];
  podeAlterar: boolean;
  vincular: (e: { cargoId: string; anterior: string | null; unidadeId: string | null }) => Promise<Resposta>;
}) {
  // O vínculo que a tela mostra: vai como "anterior" (concorrência) e passa a ser o gravado no sucesso.
  const [anterior, setAnterior] = useState(lotacao?.id ?? null);
  const [unidadeId, setUnidadeId] = useState(lotacao?.ativa ? lotacao.id : '');
  const [erros, setErros] = useState<readonly ErroCampo[]>([]);
  const [salvo, setSalvo] = useState(false);
  const [salvando, iniciar] = useTransition();
  const erroCampo = erros.filter((e) => e.campo === 'unidadeId').map((e) => e.mensagem).join(' ');
  const gerais = erros.filter((e) => e.campo !== 'unidadeId');
  const pendente = lotacao === null || !lotacao.ativa;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => {
          setSalvo(false);
          try {
            const r = await vincular({ cargoId, anterior, unidadeId: unidadeId || null });
            if (r.ok) {
              setAnterior(r.valor.unidadeId);
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
      <fieldset disabled={!podeAlterar}>
        <legend>Estrutura funcional</legend>
        {gerais.length > 0 && (
          <ul role="alert">
            {gerais.map((e, i) => (
              <li key={i}>{e.mensagem}</li>
            ))}
          </ul>
        )}
        <p role="status">{salvo ? 'Vínculo do cargo salvo.' : ''}</p>
        {pendente && (
          <p>
            <strong>Pendente de alocação:</strong>{' '}
            {lotacao === null ? 'o cargo ainda não está vinculado a uma unidade.' : `a unidade ${lotacao.rotulo} foi inativada. Vincule o cargo a uma unidade ativa.`}
          </p>
        )}
        {!podeAlterar && <p>{MSG_SO_CONSULTA}</p>}
        <label htmlFor="vinculo-unidade">Unidade (Assessoria, Coordenadoria ou Setor)</label>{' '}
        <select
          id="vinculo-unidade"
          value={unidadeId}
          onChange={(e) => setUnidadeId(e.target.value)}
          {...(erroCampo ? { 'aria-invalid': true, 'aria-describedby': 'vinculo-unidade-erro' } : {})}
        >
          <option value="">Sem vínculo</option>
          {unidades.map((u) => (
            <option key={u.id} value={u.id}>
              {u.rotulo}
            </option>
          ))}
        </select>
        {erroCampo && (
          <span id="vinculo-unidade-erro" role="alert">
            {erroCampo}
          </span>
        )}
        {unidades.length === 0 && <p>Nenhuma unidade analítica ativa. Cadastre-as em Estrutura funcional.</p>}
      </fieldset>
      {podeAlterar && (
        <button type="submit" disabled={salvando}>
          Salvar vínculo
        </button>
      )}
    </form>
  );
}
