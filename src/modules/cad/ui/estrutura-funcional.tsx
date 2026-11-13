'use client';

import { useMemo, useState, useTransition } from 'react';
import type { ErroCampo } from '@/shared/kernel';
import type { CargoOcupante } from '../application/estrutura-funcional';
import { ehAnalitica, ROTULO_TIPO, SUPERIORES_ACEITOS, TAMANHO_NOME_UNIDADE, TIPOS_UNIDADE, type NoUnidade, type TipoUnidade } from '../domain/estrutura-funcional';

// Estrutura funcional (US-048; UC03.18): a árvore (REQ_EST_001), a inclusão com o superior filtrado
// pelo tipo (REQ_EST_002), o renomear, a (in)ativação (RN_EST_04) e o painel de ocupação de cada
// unidade analítica (REQ_EST_003). Sem a permissão, só leitura.

type Resposta<T> = { ok: true; valor: T } | { ok: false; erros: readonly ErroCampo[] };

export type AcoesEstrutura = {
  incluir: (e: { nome: string; tipo: string; superiorId: string | null }) => Promise<Resposta<{ id: string }>>;
  renomear: (e: { id: string; versao: number; nome: string }) => Promise<Resposta<{ versao: number }>>;
  definirSituacao: (e: { id: string; versao: number; ativa: boolean }) => Promise<Resposta<{ versao: number }>>;
};

const planificar = (nos: readonly NoUnidade[]): NoUnidade[] => nos.flatMap((n) => [n, ...planificar(n.filhos)]);
const FALHA_REDE = 'Não foi possível salvar. Confira a conexão e tente de novo.';

export function EstruturaFuncional({
  arvore,
  ocupacao,
  podeIncluir,
  podeAlterar,
  acoes,
}: {
  arvore: readonly NoUnidade[];
  ocupacao: Readonly<Record<string, readonly CargoOcupante[]>>;
  podeIncluir: boolean;
  podeAlterar: boolean;
  acoes: AcoesEstrutura;
}) {
  const [aviso, setAviso] = useState('');
  const [erros, setErros] = useState<readonly ErroCampo[]>([]);
  const [salvando, iniciar] = useTransition();
  // onSucesso: o formulário só fecha ou limpa quando a gravação deu certo.
  const executar = <T,>(chamada: () => Promise<Resposta<T>>, sucesso: string, onSucesso?: () => void) =>
    iniciar(async () => {
      setAviso('');
      try {
        const r = await chamada();
        if (r.ok) {
          setErros([]);
          setAviso(sucesso);
          onSucesso?.();
        } else {
          setErros(r.erros);
        }
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
      {podeIncluir && (
        <NovaUnidade
          arvore={arvore}
          salvando={salvando}
          erros={erros}
          incluir={(e, limpar) => executar(() => acoes.incluir(e), `Unidade "${e.nome.trim()}" incluída.`, limpar)}
        />
      )}
      {arvore.length === 0 ? (
        <p>Nenhuma unidade cadastrada.</p>
      ) : (
        <ul aria-label="Estrutura funcional">
          {arvore.map((n) => (
            <No key={n.id} no={n} ocupacao={ocupacao} podeAlterar={podeAlterar} salvando={salvando} acoes={acoes} executar={executar} />
          ))}
        </ul>
      )}
    </div>
  );
}

function No({
  no,
  ocupacao,
  podeAlterar,
  salvando,
  acoes,
  executar,
}: {
  no: NoUnidade;
  ocupacao: Readonly<Record<string, readonly CargoOcupante[]>>;
  podeAlterar: boolean;
  salvando: boolean;
  acoes: AcoesEstrutura;
  executar: <T>(chamada: () => Promise<Resposta<T>>, sucesso: string, onSucesso?: () => void) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(no.nome);
  const cargos = ocupacao[no.id] ?? [];
  const rotulo = `${ROTULO_TIPO[no.tipo]} ${no.nome}`;
  return (
    <li>
      <strong>{no.nome}</strong> ({ROTULO_TIPO[no.tipo]}{ehAnalitica(no.tipo) ? ', analítica' : ', sintética'}){!no.ativa && ' — inativa'}
      {podeAlterar && !editando && (
        <>
          {' '}
          <button
            type="button"
            onClick={() => {
              setNome(no.nome);
              setEditando(true);
            }}
            disabled={salvando}
            aria-label={`Renomear ${rotulo}`}
          >
            Renomear
          </button>{' '}
          <button
            type="button"
            disabled={salvando}
            aria-label={`${no.ativa ? 'Inativar' : 'Reativar'} ${rotulo}`}
            onClick={() => executar(() => acoes.definirSituacao({ id: no.id, versao: no.versao, ativa: !no.ativa }), `Unidade "${no.nome}" ${no.ativa ? 'inativada' : 'reativada'}.`)}
          >
            {no.ativa ? 'Inativar' : 'Reativar'}
          </button>
        </>
      )}
      {editando && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            executar(() => acoes.renomear({ id: no.id, versao: no.versao, nome }), `Unidade renomeada para "${nome.trim()}".`, () => setEditando(false));
          }}
        >
          <label htmlFor={`nome-${no.id}`}>Novo nome de {rotulo}</label>{' '}
          <input id={`nome-${no.id}`} value={nome} maxLength={TAMANHO_NOME_UNIDADE} onChange={(e) => setNome(e.target.value)} />{' '}
          <button type="submit" disabled={salvando}>
            Salvar
          </button>{' '}
          <button type="button" onClick={() => (setEditando(false), setNome(no.nome))}>
            Cancelar
          </button>
        </form>
      )}
      {ehAnalitica(no.tipo) && (
        // Painel de ocupação (REQ_EST_003).
        <p>
          {cargos.length === 0 ? 'Nenhum cargo vinculado.' : `Cargos vinculados: ${cargos.map((c) => `${c.codigo} ${c.nome}`).join('; ')}.`}
        </p>
      )}
      {no.filhos.length > 0 && (
        <ul>
          {no.filhos.map((f) => (
            <No key={f.id} no={f} ocupacao={ocupacao} podeAlterar={podeAlterar} salvando={salvando} acoes={acoes} executar={executar} />
          ))}
        </ul>
      )}
    </li>
  );
}

function NovaUnidade({
  arvore,
  salvando,
  erros,
  incluir,
}: {
  arvore: readonly NoUnidade[];
  salvando: boolean;
  erros: readonly ErroCampo[];
  incluir: (e: { nome: string; tipo: string; superiorId: string | null }, limpar: () => void) => void;
}) {
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<TipoUnidade>('DIRETORIA');
  const [superiorId, setSuperiorId] = useState('');
  // Só os superiores que o tipo aceita, ativos (E1).
  const opcoes = useMemo(
    () => planificar(arvore).filter((n) => n.ativa && SUPERIORES_ACEITOS[tipo].includes(n.tipo)),
    [arvore, tipo],
  );
  const podeTopo = SUPERIORES_ACEITOS[tipo].includes(null);
  // Superior que saiu da lista (inativado ou de outro tipo) não é enviado.
  const superiorEfetivo = opcoes.some((o) => o.id === superiorId) ? superiorId : '';
  const erroDe = (campo: string) => erros.filter((e) => e.campo === campo).map((e) => e.mensagem).join(' ');
  const aria = (campo: string) => (erroDe(campo) ? { 'aria-invalid': true, 'aria-describedby': `nova-${campo}-erro` } : {});
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        incluir({ nome, tipo, superiorId: superiorEfetivo || null }, () => setNome(''));
      }}
    >
      <fieldset>
        <legend>Nova unidade</legend>
        <label htmlFor="nova-nome">Nome da unidade</label>{' '}
        <input id="nova-nome" value={nome} maxLength={TAMANHO_NOME_UNIDADE} onChange={(e) => setNome(e.target.value)} {...aria('nome')} />{' '}
        {erroDe('nome') && <span id="nova-nome-erro">{erroDe('nome')}</span>}{' '}
        <label htmlFor="nova-tipo">Tipo</label>{' '}
        <select
          id="nova-tipo"
          value={tipo}
          onChange={(e) => {
            setTipo(e.target.value as TipoUnidade);
            setSuperiorId('');
          }}
        >
          {TIPOS_UNIDADE.map((t) => (
            <option key={t} value={t}>
              {ROTULO_TIPO[t]} ({ehAnalitica(t) ? 'analítica' : 'sintética'})
            </option>
          ))}
        </select>{' '}
        <label htmlFor="nova-superior">Unidade superior</label>{' '}
        <select id="nova-superior" value={superiorEfetivo} onChange={(e) => setSuperiorId(e.target.value)} {...aria('superiorId')}>
          {podeTopo && <option value="">Nenhuma (topo)</option>}
          {!podeTopo && <option value="">Escolha</option>}
          {opcoes.map((n) => (
            <option key={n.id} value={n.id}>
              {ROTULO_TIPO[n.tipo]} {n.nome}
            </option>
          ))}
        </select>{' '}
        {erroDe('superiorId') && <span id="nova-superiorId-erro">{erroDe('superiorId')}</span>}{' '}
        <button type="submit" disabled={salvando}>
          Incluir
        </button>
      </fieldset>
    </form>
  );
}
