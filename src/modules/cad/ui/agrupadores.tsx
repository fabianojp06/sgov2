'use client';

import { useMemo, useState, useTransition } from 'react';
import type { ErroCampo } from '@/shared/kernel';
import type { AgrupadorTela, ContaAgrupavel } from '../application/agrupadores';
import { TAMANHO_NOME_AGRUPADOR } from '../domain/agrupadores';

// Painel de agrupadores de contas (US-047; RF_PLA_REQ_005): a lista, com as contas de cada um, e o
// formulário de inclusão e edição com o seletor múltiplo das analíticas ativas (com filtro). Excluir
// pede confirmação (A4.2). Sem cad.plano_contas:executar, só leitura.

type Resposta<T> = { ok: true; valor: T } | { ok: false; erros: readonly ErroCampo[] };
export type AcoesAgrupadores = {
  incluir: (e: { nome: string; contaIds: string[] }) => Promise<Resposta<{ id: string }>>;
  alterar: (e: { id: string; versao: number; nome: string; contaIds: string[] }) => Promise<Resposta<{ versao: number }>>;
  excluir: (e: { id: string; versao: number }) => Promise<Resposta<{ excluido: true }>>;
};

const FALHA_REDE = 'Não foi possível salvar. Confira a conexão e tente de novo.';
// As contas inativas (uma recarga inativou depois) continuam no agrupador e aparecem marcadas no
// formulário: só saem se o usuário desmarcar.
type Edicao = { id: string | null; versao: number; nome: string; contaIds: readonly string[]; inativas: readonly ContaAgrupavel[] };

export function Agrupadores({
  agrupadores,
  contas,
  podeAlterar,
  acoes,
}: {
  agrupadores: readonly AgrupadorTela[];
  contas: readonly ContaAgrupavel[];
  podeAlterar: boolean;
  acoes: AcoesAgrupadores;
}) {
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [aviso, setAviso] = useState('');
  const [erros, setErros] = useState<readonly ErroCampo[]>([]);
  const [salvando, iniciar] = useTransition();
  const executar = <T,>(chamada: () => Promise<Resposta<T>>, sucesso: string, onSucesso?: () => void) =>
    iniciar(async () => {
      setAviso('');
      try {
        const r = await chamada();
        if (r.ok) {
          setErros([]);
          setAviso(sucesso);
          onSucesso?.();
        } else setErros(r.erros);
      } catch {
        setErros([{ campo: '_', mensagem: FALHA_REDE }]);
      }
    });

  return (
    <div aria-busy={salvando}>
      <p role="status">{aviso}</p>
      {erros.length > 0 && (
        <ul role="alert" id="agrupador-erros">
          {erros.map((e, i) => (
            <li key={i}>{e.mensagem}</li>
          ))}
        </ul>
      )}
      {podeAlterar && !edicao && (
        <p>
          <button
            type="button"
            onClick={() => {
              setErros([]);
              setEdicao({ id: null, versao: 0, nome: '', contaIds: [], inativas: [] });
            }}
          >
            Novo Agrupador
          </button>
        </p>
      )}
      {edicao && (
        <FormAgrupador
          key={edicao.id ?? 'novo'}
          edicao={edicao}
          contas={contas}
          salvando={salvando}
          erros={erros}
          cancelar={() => {
            setErros([]);
            setEdicao(null);
          }}
          salvar={(nome, contaIds) =>
            edicao.id === null
              ? executar(() => acoes.incluir({ nome, contaIds }), `Agrupador ${nome.trim()} incluído.`, () => setEdicao(null))
              : executar(() => acoes.alterar({ id: edicao.id!, versao: edicao.versao, nome, contaIds }), `Agrupador ${nome.trim()} alterado.`, () => setEdicao(null))
          }
        />
      )}
      {agrupadores.length === 0 ? (
        <p>Nenhum agrupador cadastrado.</p>
      ) : (
        <table aria-label="Agrupadores de contas">
          <thead>
            <tr>
              <th scope="col">Agrupador</th>
              <th scope="col">Contas analíticas</th>
              {podeAlterar && <th scope="col">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {agrupadores.map((a) => (
              <tr key={a.id}>
                <td>{a.nome}</td>
                <td>
                  <ul>
                    {a.contas.map((c) => (
                      <li key={c.id}>
                        {c.classificacao} — {c.descricao}
                        {!c.ativa && ' (inativa)'}
                      </li>
                    ))}
                  </ul>
                </td>
                {podeAlterar && (
                  <td>
                    <button
                      type="button"
                      disabled={salvando}
                      aria-label={`Editar o agrupador ${a.nome}`}
                      onClick={() => {
                        setErros([]);
                        setEdicao({ id: a.id, versao: a.versao, nome: a.nome, contaIds: a.contas.map((c) => c.id), inativas: a.contas.filter((c) => !c.ativa) });
                      }}
                    >
                      Editar
                    </button>{' '}
                    <button
                      type="button"
                      disabled={salvando}
                      aria-label={`Excluir o agrupador ${a.nome}`}
                      onClick={() => {
                        if (!window.confirm(`Deseja excluir o Agrupador ${a.nome}? Esta ação removerá o subtotal correspondente de todos os relatórios vinculados.`)) return;
                        executar(() => acoes.excluir({ id: a.id, versao: a.versao }), `Agrupador ${a.nome} excluído.`, () =>
                          setEdicao((e) => (e?.id === a.id ? null : e)),
                        );
                      }}
                    >
                      Excluir
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function FormAgrupador({
  edicao,
  contas,
  salvando,
  erros,
  cancelar,
  salvar,
}: {
  edicao: Edicao;
  contas: readonly ContaAgrupavel[];
  salvando: boolean;
  erros: readonly ErroCampo[];
  cancelar: () => void;
  salvar: (nome: string, contaIds: string[]) => void;
}) {
  const [nome, setNome] = useState(edicao.nome);
  const [marcadas, setMarcadas] = useState<ReadonlySet<string>>(new Set(edicao.contaIds));
  const [filtro, setFiltro] = useState('');
  const inativas = useMemo(() => new Set(edicao.inativas.map((c) => c.id)), [edicao.inativas]);
  const visiveis = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    const todas = [...edicao.inativas, ...contas].sort((x, y) => (x.classificacao < y.classificacao ? -1 : 1));
    return f ? todas.filter((c) => c.classificacao.includes(f) || c.descricao.toLowerCase().includes(f)) : todas;
  }, [contas, edicao.inativas, filtro]);
  const invalido = (campo: string) => (erros.some((e) => e.campo === campo) ? { 'aria-invalid': true, 'aria-describedby': 'agrupador-erros' } : {});
  const alternar = (id: string) =>
    setMarcadas((m) => {
      const n = new Set(m);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        salvar(nome, [...marcadas]);
      }}
    >
      <fieldset>
        <legend>{edicao.id === null ? 'Novo Agrupador' : `Editar o agrupador ${edicao.nome}`}</legend>
        <p>
          <label htmlFor="agrupador-nome">Nome do Agrupador</label>{' '}
          <input id="agrupador-nome" value={nome} maxLength={TAMANHO_NOME_AGRUPADOR} onChange={(e) => setNome(e.target.value)} {...invalido('nome')} />
        </p>
        <p>
          <label htmlFor="agrupador-filtro">Filtrar contas</label>{' '}
          <input id="agrupador-filtro" type="search" value={filtro} onChange={(e) => setFiltro(e.target.value)} /> {marcadas.size} conta(s) selecionada(s)
        </p>
        <fieldset style={{ maxHeight: '18rem', overflowY: 'auto' }}>
          <legend>Contas analíticas (ao menos duas)</legend>
          {visiveis.length === 0 ? (
            <p>Nenhuma conta analítica ativa com esse filtro.</p>
          ) : (
            visiveis.map((c) => (
              <div key={c.id}>
                <input type="checkbox" id={`agrupador-conta-${c.id}`} checked={marcadas.has(c.id)} onChange={() => alternar(c.id)} {...invalido('contas')} />{' '}
                <label htmlFor={`agrupador-conta-${c.id}`}>
                  {c.classificacao} — {c.descricao}
                  {inativas.has(c.id) && ' (inativa: desmarque para tirar do agrupador)'}
                </label>
              </div>
            ))
          )}
        </fieldset>
        <p>
          <button type="submit" disabled={salvando}>
            Salvar Agrupador
          </button>{' '}
          <button type="button" onClick={cancelar} disabled={salvando}>
            Cancelar
          </button>
        </p>
      </fieldset>
    </form>
  );
}
