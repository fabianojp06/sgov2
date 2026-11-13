'use client';

import { useState, useTransition } from 'react';
import type { ErroCampo } from '@/shared/kernel';
import type { ImpostoTela } from '../application/impostos';
import { INCIDENCIAS, ROTULO_INCIDENCIA, TAMANHO_NOME_IMPOSTO, type Competencia } from '../domain/impostos';

// Impostos e alíquotas com vigência (US-052; REQ_TAX_001): a lista com a alíquota vigente no mês e o
// histórico; incluir e alterar imposto; incluir alíquota de competência atual ou futura (sem
// retroatividade, RN_TAX_05) e remover a que ainda não começou a valer. Sem a permissão, só leitura.

type Resposta<T> = { ok: true; valor: T } | { ok: false; erros: readonly ErroCampo[] };
export type AcoesImpostos = {
  incluir: (e: { nome: string; incidencia: string }) => Promise<Resposta<{ id: string }>>;
  alterar: (e: { id: string; versao: number; nome: string; incidencia: string; ativo: boolean }) => Promise<Resposta<{ versao: number }>>;
  incluirAliquota: (e: { impostoId: string; competencia: string; percentual: string }) => Promise<Resposta<{ competencia: Competencia }>>;
  removerAliquota: (e: { impostoId: string; competencia: string }) => Promise<Resposta<{ removida: boolean }>>;
};

const FALHA_REDE = 'Não foi possível salvar. Confira a conexão e tente de novo.';

export function Impostos({
  mesAtual,
  impostos,
  podeIncluir,
  podeAlterar,
  acoes,
}: {
  mesAtual: Competencia;
  impostos: readonly ImpostoTela[];
  podeIncluir: boolean;
  podeAlterar: boolean;
  acoes: AcoesImpostos;
}) {
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
        <ul role="alert">
          {erros.map((e, i) => (
            <li key={i}>{e.mensagem}</li>
          ))}
        </ul>
      )}
      {podeIncluir && <NovoImposto salvando={salvando} incluir={(e, limpar) => executar(() => acoes.incluir(e), `Imposto ${e.nome.trim()} incluído.`, limpar)} />}
      {impostos.length === 0 ? (
        <p>Nenhum imposto cadastrado.</p>
      ) : (
        impostos.map((i) => <Imposto key={i.id} imposto={i} mesAtual={mesAtual} podeAlterar={podeAlterar} salvando={salvando} acoes={acoes} executar={executar} />)
      )}
    </div>
  );
}

function Imposto({
  imposto: i,
  mesAtual,
  podeAlterar,
  salvando,
  acoes,
  executar,
}: {
  imposto: ImpostoTela;
  mesAtual: Competencia;
  podeAlterar: boolean;
  salvando: boolean;
  acoes: AcoesImpostos;
  executar: <T>(chamada: () => Promise<Resposta<T>>, sucesso: string, onSucesso?: () => void) => void;
}) {
  const [competencia, setCompetencia] = useState<string>(mesAtual);
  const [percentual, setPercentual] = useState('');
  const idBase = `imposto-${i.id}`;
  return (
    <section aria-labelledby={`${idBase}-titulo`}>
      <h2 id={`${idBase}-titulo`}>
        {i.nome} ({ROTULO_INCIDENCIA[i.incidencia]}){!i.ativo && ' — inativo'}
      </h2>
      <p>Alíquota vigente em {mesAtual}: {i.vigente ? `${i.vigente.percentual}% (desde ${i.vigente.competencia})` : 'nenhuma'}.</p>
      {podeAlterar && (
        <p>
          <button
            type="button"
            disabled={salvando}
            onClick={() =>
              executar(
                () => acoes.alterar({ id: i.id, versao: i.versao, nome: i.nome, incidencia: i.incidencia, ativo: !i.ativo }),
                `Imposto ${i.nome} ${i.ativo ? 'inativado' : 'reativado'}.`,
              )
            }
          >
            {i.ativo ? `Inativar ${i.nome}` : `Reativar ${i.nome}`}
          </button>
        </p>
      )}
      {i.aliquotas.length > 0 && (
        <table aria-label={`Alíquotas do ${i.nome}`}>
          <thead>
            <tr>
              <th scope="col">A partir de</th>
              <th scope="col">Alíquota</th>
              {podeAlterar && <th scope="col">Ação</th>}
            </tr>
          </thead>
          <tbody>
            {i.aliquotas.map((a) => (
              <tr key={a.competencia}>
                <td>{a.competencia}</td>
                <td>{a.percentual}%</td>
                {podeAlterar && (
                  <td>
                    {a.futura ? (
                      <button
                        type="button"
                        disabled={salvando}
                        aria-label={`Remover a alíquota do ${i.nome} de ${a.competencia}`}
                        onClick={() => executar(() => acoes.removerAliquota({ impostoId: i.id, competencia: a.competencia }), `Alíquota de ${a.competencia} removida.`)}
                      >
                        Remover
                      </button>
                    ) : (
                      'em vigor ou passada'
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {podeAlterar && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            executar(
              () => acoes.incluirAliquota({ impostoId: i.id, competencia, percentual }),
              `Alíquota do ${i.nome} a partir de ${competencia} incluída.`,
              () => setPercentual(''),
            );
          }}
        >
          <fieldset>
            <legend>Nova alíquota do {i.nome}</legend>
            <label htmlFor={`${idBase}-competencia`}>A partir de (AAAA-MM)</label>{' '}
            <input id={`${idBase}-competencia`} type="month" min={mesAtual} value={competencia} onChange={(e) => setCompetencia(e.target.value)} />{' '}
            <label htmlFor={`${idBase}-percentual`}>Alíquota (%)</label>{' '}
            <input id={`${idBase}-percentual`} inputMode="decimal" value={percentual} onChange={(e) => setPercentual(e.target.value)} />{' '}
            <button type="submit" disabled={salvando}>
              Incluir alíquota
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}

function NovoImposto({ salvando, incluir }: { salvando: boolean; incluir: (e: { nome: string; incidencia: string }, limpar: () => void) => void }) {
  const [nome, setNome] = useState('');
  const [incidencia, setIncidencia] = useState<string>('AMBOS');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        incluir({ nome, incidencia }, () => setNome(''));
      }}
    >
      <fieldset>
        <legend>Novo imposto</legend>
        <label htmlFor="novo-imposto-nome">Nome do imposto</label>{' '}
        <input id="novo-imposto-nome" value={nome} maxLength={TAMANHO_NOME_IMPOSTO} onChange={(e) => setNome(e.target.value)} />{' '}
        <label htmlFor="novo-imposto-incidencia">Tipo de incidência</label>{' '}
        <select id="novo-imposto-incidencia" value={incidencia} onChange={(e) => setIncidencia(e.target.value)}>
          {INCIDENCIAS.map((x) => (
            <option key={x} value={x}>
              {ROTULO_INCIDENCIA[x]}
            </option>
          ))}
        </select>{' '}
        <button type="submit" disabled={salvando}>
          Incluir imposto
        </button>
      </fieldset>
    </form>
  );
}
