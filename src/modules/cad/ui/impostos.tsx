'use client';

import { useState, useTransition } from 'react';
import type { ErroCampo } from '@/shared/kernel';
import type { ImpostoTela } from '../application/impostos';
import { INCIDENCIAS, ROTULO_INCIDENCIA, TAMANHO_NOME_IMPOSTO, type AnoMes } from '../domain/impostos';

// Impostos e alíquotas com vigência (US-052; REQ_TAX_001): a lista com a alíquota vigente no mês e o
// histórico; incluir e alterar imposto; incluir alíquota de competência atual ou futura (sem
// retroatividade, RN_TAX_05) e remover a que ainda não começou a valer. Sem a permissão, só leitura.

type Resposta<T> = { ok: true; valor: T } | { ok: false; erros: readonly ErroCampo[] };
export type AcoesImpostos = {
  incluir: (e: { nome: string; incidencia: string }) => Promise<Resposta<{ id: string }>>;
  alterar: (e: { id: string; versao: number; nome: string; incidencia: string; ativo: boolean }) => Promise<Resposta<{ versao: number }>>;
  incluirAliquota: (e: { impostoId: string; competencia: string; percentual: string }) => Promise<Resposta<{ competencia: AnoMes }>>;
  removerAliquota: (e: { impostoId: string; competencia: string }) => Promise<Resposta<{ removida: boolean }>>;
};

const FALHA_REDE = 'Não foi possível salvar. Confira a conexão e tente de novo.';
const CONFIRMA_MES_ATUAL = (nome: string, competencia: string, percentual: string) =>
  `A alíquota de ${percentual}% do ${nome} passa a valer agora, em ${competencia}, e não poderá ser alterada nem removida. Confirma?`;

// O aviso e os erros ficam junto do formulário que os gerou: 'novo' ou o id do imposto.
type Mensagens = Readonly<{ alvo: string; aviso: string; erros: readonly ErroCampo[] }>;
type Executar = <T>(alvo: string, chamada: () => Promise<Resposta<T>>, sucesso: string, onSucesso?: () => void) => void;

export function Impostos({
  mesAtual,
  impostos,
  podeIncluir,
  podeAlterar,
  acoes,
}: {
  mesAtual: AnoMes;
  impostos: readonly ImpostoTela[];
  podeIncluir: boolean;
  podeAlterar: boolean;
  acoes: AcoesImpostos;
}) {
  const [mensagens, setMensagens] = useState<Mensagens>({ alvo: '', aviso: '', erros: [] });
  const [salvando, iniciar] = useTransition();
  const executar: Executar = (alvo, chamada, sucesso, onSucesso) =>
    iniciar(async () => {
      setMensagens({ alvo, aviso: '', erros: [] });
      try {
        const r = await chamada();
        if (r.ok) {
          setMensagens({ alvo, aviso: sucesso, erros: [] });
          onSucesso?.();
        } else setMensagens({ alvo, aviso: '', erros: r.erros });
      } catch {
        setMensagens({ alvo, aviso: '', erros: [{ campo: '_', mensagem: FALHA_REDE }] });
      }
    });
  const de = (alvo: string): Mensagens => (mensagens.alvo === alvo ? mensagens : { alvo, aviso: '', erros: [] });

  return (
    <div aria-busy={salvando}>
      {podeIncluir && (
        <NovoImposto
          salvando={salvando}
          mensagens={de('novo')}
          incluir={(e, limpar) => executar('novo', () => acoes.incluir(e), `Imposto ${e.nome.trim()} incluído.`, limpar)}
        />
      )}
      {impostos.length === 0 ? (
        <p>Nenhum imposto cadastrado.</p>
      ) : (
        impostos.map((i) => (
          <Imposto key={i.id} imposto={i} mesAtual={mesAtual} podeAlterar={podeAlterar} salvando={salvando} mensagens={de(i.id)} acoes={acoes} executar={executar} />
        ))
      )}
    </div>
  );
}

function Imposto({
  imposto: i,
  mesAtual,
  podeAlterar,
  salvando,
  mensagens,
  acoes,
  executar,
}: {
  imposto: ImpostoTela;
  mesAtual: AnoMes;
  podeAlterar: boolean;
  salvando: boolean;
  mensagens: Mensagens;
  acoes: AcoesImpostos;
  executar: Executar;
}) {
  const [competencia, setCompetencia] = useState<string>(mesAtual);
  const [percentual, setPercentual] = useState('');
  const idBase = `imposto-${i.id}`;
  return (
    <section aria-labelledby={`${idBase}-titulo`}>
      <h2 id={`${idBase}-titulo`}>
        {i.nome} ({ROTULO_INCIDENCIA[i.incidencia]}){!i.ativo && ' — inativo'}
      </h2>
      <Retorno mensagens={mensagens} id={`${idBase}-erros`} />
      <p>Alíquota vigente em {mesAtual}: {i.vigente ? `${i.vigente.percentual}% (desde ${i.vigente.competencia})` : 'nenhuma'}.</p>
      {podeAlterar && (
        <p>
          <button
            type="button"
            disabled={salvando}
            onClick={() =>
              executar(
                i.id,
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
                        onClick={() => executar(i.id, () => acoes.removerAliquota({ impostoId: i.id, competencia: a.competencia }), `Alíquota de ${a.competencia} removida.`)}
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
            if (competencia === mesAtual && !window.confirm(CONFIRMA_MES_ATUAL(i.nome, competencia, percentual))) return;
            executar(
              i.id,
              () => acoes.incluirAliquota({ impostoId: i.id, competencia, percentual }),
              `Alíquota do ${i.nome} a partir de ${competencia} incluída.`,
              () => setPercentual(''),
            );
          }}
        >
          <fieldset>
            <legend>Nova alíquota do {i.nome}</legend>
            <label htmlFor={`${idBase}-competencia`}>A partir de (AAAA-MM)</label>{' '}
            <input
              id={`${idBase}-competencia`}
              type="month"
              min={mesAtual}
              placeholder="AAAA-MM"
              pattern="\d{4}-\d{2}"
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value)}
              {...invalido(mensagens, 'competencia', `${idBase}-erros`)}
            />{' '}
            <label htmlFor={`${idBase}-percentual`}>Alíquota (%)</label>{' '}
            <input
              id={`${idBase}-percentual`}
              inputMode="decimal"
              value={percentual}
              onChange={(e) => setPercentual(e.target.value)}
              {...invalido(mensagens, 'percentual', `${idBase}-erros`)}
            />{' '}
            <button type="submit" disabled={salvando}>
              Incluir alíquota
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}

function Retorno({ mensagens, id }: { mensagens: Mensagens; id: string }) {
  return (
    <>
      <p role="status">{mensagens.aviso}</p>
      {mensagens.erros.length > 0 && (
        <ul role="alert" id={id}>
          {mensagens.erros.map((e, i) => (
            <li key={i}>{e.mensagem}</li>
          ))}
        </ul>
      )}
    </>
  );
}

const invalido = (m: Mensagens, campo: string, idErros: string) =>
  m.erros.some((e) => e.campo === campo) ? { 'aria-invalid': true, 'aria-describedby': idErros } : {};

function NovoImposto({
  salvando,
  mensagens,
  incluir,
}: {
  salvando: boolean;
  mensagens: Mensagens;
  incluir: (e: { nome: string; incidencia: string }, limpar: () => void) => void;
}) {
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
        <Retorno mensagens={mensagens} id="novo-imposto-erros" />
        <label htmlFor="novo-imposto-nome">Nome do imposto</label>{' '}
        <input
          id="novo-imposto-nome"
          value={nome}
          maxLength={TAMANHO_NOME_IMPOSTO}
          onChange={(e) => setNome(e.target.value)}
          {...invalido(mensagens, 'nome', 'novo-imposto-erros')}
        />{' '}
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
