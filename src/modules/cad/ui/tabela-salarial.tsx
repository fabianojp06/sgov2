'use client';

import { useState, useTransition } from 'react';
import { GradeArvore, type NoGrade } from '@/modules/ger';
import { Dinheiro, type ErroCampo } from '@/shared/kernel';
import type { FaixaTela, SenioridadeTela } from '../domain/cargo-tela';

// Tabela salarial de mercado e senioridades (US-049 parte 3; UC03.19 §5). A exclusão é inativação.
// Júnior, Pleno e Sênior são padrão e não se inativam (RN_TAB_01).
type Resposta = { ok: true; valor?: unknown } | { ok: false; erros: readonly ErroCampo[] };
type Colunas = 'cargo' | 'senioridade' | 'minimo' | 'maximo' | 'situacao';
type DadosFaixa = { cargoId: string; senioridadeId: string; minimo: string; maximo: string };

const VAZIA: DadosFaixa = { cargoId: '', senioridadeId: '', minimo: '', maximo: '' };

export function TabelaSalarial({
  faixas,
  senioridades,
  cargos,
  podeIncluir,
  podeAlterar,
  podeExcluir,
  incluirFaixa,
  alterarFaixa,
  inativarFaixa,
  incluirSenioridade,
  inativarSenioridade,
}: {
  faixas: readonly FaixaTela[];
  senioridades: readonly SenioridadeTela[];
  cargos: readonly { id: string; rotulo: string }[];
  podeIncluir: boolean;
  podeAlterar: boolean;
  podeExcluir: boolean;
  incluirFaixa: (e: DadosFaixa) => Promise<Resposta>;
  alterarFaixa: (e: DadosFaixa & { idFaixa: string; versao: number }) => Promise<Resposta>;
  inativarFaixa: (e: { idFaixa: string; versao: number }) => Promise<Resposta>;
  incluirSenioridade: (e: { nome: string }) => Promise<Resposta>;
  inativarSenioridade: (e: { idSenioridade: string }) => Promise<Resposta>;
}) {
  const [editando, setEditando] = useState<{ id: string | null; versao: number; dados: DadosFaixa } | null>(null);
  const [escolhida, setEscolhida] = useState('');
  const [novaSenioridade, setNovaSenioridade] = useState('');
  const [erros, setErros] = useState<readonly ErroCampo[]>([]);
  const [aviso, setAviso] = useState('');
  const [enviando, iniciar] = useTransition();
  const ativas = senioridades.filter((s) => s.ativa);
  const erroDe = (c: string) => erros.filter((e) => e.campo === c).map((e) => e.mensagem).join(' ');
  const gerais = erros.filter((e) => !['cargoId', 'senioridadeId', 'minimo', 'maximo', 'nome'].includes(e.campo)).map((e) => e.mensagem);

  const executar = (acao: () => Promise<Resposta>, sucesso: string, fechar = true, depois?: () => void) =>
    iniciar(async () => {
      setAviso('');
      try {
        const r = await acao();
        if (r.ok) {
          setErros([]);
          setAviso(sucesso);
          depois?.();
          if (fechar) setEditando(null);
        } else setErros(r.erros);
      } catch {
        setErros([{ campo: '_', mensagem: 'Não foi possível salvar. Confira a conexão e tente de novo.' }]);
      }
    });

  const nos: NoGrade<Colunas>[] = faixas.map((f) => ({
    id: f.id,
    linha: { cargo: f.cargo, senioridade: f.senioridade, minimo: f.minimo, maximo: f.maximo, situacao: f.ativa ? 'Ativa' : 'Inativa' },
  }));
  const ativasFaixas = faixas.filter((f) => f.ativa);

  return (
    <section>
      <p role="status">{aviso}</p>
      {gerais.length > 0 && (
        <ul role="alert">
          {gerais.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
      <GradeArvore<Colunas>
        idGrade="cad.tabela_salarial"
        rotulo="Tabela salarial"
        nos={nos}
        colunas={[
          { campo: 'cargo', titulo: 'Cargo', tipo: 'texto' },
          { campo: 'senioridade', titulo: 'Senioridade', tipo: 'texto' },
          { campo: 'minimo', titulo: 'Salário mínimo', tipo: 'dinheiro' },
          { campo: 'maximo', titulo: 'Salário máximo', tipo: 'dinheiro' },
          { campo: 'situacao', titulo: 'Situação', tipo: 'texto' },
        ]}
        textoVazio="Nenhuma faixa salarial cadastrada."
      />
      {podeIncluir && (
        <button
          type="button"
          onClick={() => {
            setErros([]);
            setEditando({ id: null, versao: 0, dados: VAZIA });
          }}
        >
          Incluir faixa
        </button>
      )}
      {(podeAlterar || podeExcluir) && ativasFaixas.length > 0 && (
        <div>
          <label htmlFor="faixa-escolhida">Alterar ou inativar a faixa</label>{' '}
          <select id="faixa-escolhida" value={escolhida} onChange={(e) => setEscolhida(e.target.value)}>
            <option value="">Escolha uma faixa</option>
            {ativasFaixas.map((f) => (
              <option key={f.id} value={f.id}>
                {`${f.cargo} / ${f.senioridade}: ${Dinheiro.de(f.minimo).formatar()} a ${Dinheiro.de(f.maximo).formatar()}`}
              </option>
            ))}
          </select>{' '}
          <button
            type="button"
            disabled={!escolhida}
            onClick={() => {
              const f = faixas.find((x) => x.id === escolhida);
              if (!f) return;
              setErros([]);
              setEditando({ id: f.id, versao: f.versao, dados: { cargoId: f.cargoId, senioridadeId: f.senioridadeId, minimo: f.minimo, maximo: f.maximo } });
            }}
          >
            Abrir
          </button>
        </div>
      )}
      {editando && (
        <form
          aria-label={editando.id ? 'Alterar faixa' : 'Incluir faixa'}
          onSubmit={(e) => {
            e.preventDefault();
            const { id, versao, dados } = editando;
            executar(() => (id ? alterarFaixa({ ...dados, idFaixa: id, versao }) : incluirFaixa(dados)), id ? 'Faixa alterada.' : 'Faixa incluída.');
          }}
          noValidate
        >
          <h2>{editando.id ? 'Alterar faixa' : 'Incluir faixa'}</h2>
          <Selecao
            id="cargoId"
            rotulo="Cargo"
            valor={editando.dados.cargoId}
            erro={erroDe('cargoId')}
            opcoes={cargos.map((c) => ({ valor: c.id, rotulo: c.rotulo }))}
            mudar={(v) => setEditando({ ...editando, dados: { ...editando.dados, cargoId: v } })}
          />
          <Selecao
            id="senioridadeId"
            rotulo="Senioridade"
            valor={editando.dados.senioridadeId}
            erro={erroDe('senioridadeId')}
            opcoes={ativas.map((s) => ({ valor: s.id, rotulo: s.nome }))}
            mudar={(v) => setEditando({ ...editando, dados: { ...editando.dados, senioridadeId: v } })}
          />
          <Campo id="minimo" rotulo="Salário mínimo (R$)" valor={editando.dados.minimo} erro={erroDe('minimo')} mudar={(v) => setEditando({ ...editando, dados: { ...editando.dados, minimo: v } })} />
          <Campo id="maximo" rotulo="Salário máximo (R$)" valor={editando.dados.maximo} erro={erroDe('maximo')} mudar={(v) => setEditando({ ...editando, dados: { ...editando.dados, maximo: v } })} />
          <button type="submit" disabled={enviando}>
            Salvar
          </button>
          {editando.id && podeExcluir && (
            <button type="button" disabled={enviando} onClick={() => executar(() => inativarFaixa({ idFaixa: editando.id as string, versao: editando.versao }), 'Faixa inativada.')}>
              Inativar
            </button>
          )}
          <button type="button" onClick={() => setEditando(null)}>
            Cancelar
          </button>
        </form>
      )}
      <section aria-labelledby="titulo-senioridades">
        <h2 id="titulo-senioridades">Senioridades</h2>
        <ul>
          {senioridades.map((s) => (
            <li key={s.id}>
              {s.nome}
              {s.padrao ? ' (padrão)' : ''}
              {s.ativa ? '' : ' (inativa)'}
              {podeExcluir && !s.padrao && s.ativa && (
                <>
                  {' '}
                  <button type="button" disabled={enviando} onClick={() => executar(() => inativarSenioridade({ idSenioridade: s.id }), `Senioridade ${s.nome} inativada.`, false)}>
                    Inativar {s.nome}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
        {podeIncluir && (
          <form
            aria-label="Incluir senioridade"
            onSubmit={(e) => {
              e.preventDefault();
              // O nome só some se der certo: com erro ("Já existe…"), fica para corrigir.
              executar(() => incluirSenioridade({ nome: novaSenioridade }), `Senioridade ${novaSenioridade.trim()} incluída.`, false, () => setNovaSenioridade(''));
            }}
            noValidate
          >
            <Campo id="nome" rotulo="Nova senioridade" valor={novaSenioridade} erro={erroDe('nome')} texto mudar={setNovaSenioridade} />
            <button type="submit" disabled={enviando}>
              Incluir senioridade
            </button>
          </form>
        )}
      </section>
    </section>
  );
}

function Campo({ id, rotulo, valor, erro, mudar, texto }: { id: string; rotulo: string; valor: string; erro: string; mudar: (v: string) => void; texto?: boolean }) {
  const idCampo = `faixa-${id}`;
  return (
    <div>
      <label htmlFor={idCampo}>{rotulo}</label>{' '}
      <input
        id={idCampo}
        value={valor}
        {...(texto ? { maxLength: 40 } : { inputMode: 'decimal' as const })}
        onChange={(e) => mudar(e.target.value)}
        {...(erro ? { 'aria-invalid': true, 'aria-describedby': `${idCampo}-erro` } : {})}
      />
      {erro && <span id={`${idCampo}-erro`}>{erro}</span>}
    </div>
  );
}

function Selecao({ id, rotulo, valor, erro, opcoes, mudar }: { id: string; rotulo: string; valor: string; erro: string; opcoes: readonly { valor: string; rotulo: string }[]; mudar: (v: string) => void }) {
  const idCampo = `faixa-${id}`;
  return (
    <div>
      <label htmlFor={idCampo}>{rotulo}</label>{' '}
      <select id={idCampo} value={valor} onChange={(e) => mudar(e.target.value)} {...(erro ? { 'aria-invalid': true, 'aria-describedby': `${idCampo}-erro` } : {})}>
        <option value="">Escolha</option>
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
      {erro && <span id={`${idCampo}-erro`}>{erro}</span>}
    </div>
  );
}
