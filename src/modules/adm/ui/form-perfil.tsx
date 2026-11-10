'use client';

import { useEffect, useRef, useState } from 'react';
import { ErroDoCampo, Formulario, LegendaComErro, type AcaoFormulario } from '@/modules/ger';
import {
  AVISO_SEM_ESCOPO,
  MENSAGEM_CONFIRMAR_INATIVACAO,
  MENSAGEM_CONFIRMAR_INATIVACAO_SEM_USUARIOS,
  NOTA_ADMINISTRADOR_ATIVO,
  precisaAvisoSemEscopo,
} from '../domain/perfil-textos';
import {
  alternarAcao,
  alternarFuncionalidade,
  alternarModulo,
  colunasDoModulo,
  ehFixa,
  estadoFuncionalidade,
  estadoInicial,
  estadoModulo,
  paraEntrada,
  type EstadoCaixa,
  type EstadoGrade,
  type ModuloGrade,
} from './grade-permissoes';

// Formulário de cadastro (UC02.25) e alteração (UC02.26) de perfil, com a seção "Definição de
// Permissões de Acesso" (D-P13-12). Componente cliente: recebe a ação, a grade e o perfil por props da
// página (não importa o index do módulo, que tem servidor). As regras da grade estão em
// grade-permissoes.ts; o servidor revalida tudo (RNF0003).
export type PerfilFormulario = {
  id: string;
  nome: string;
  descricao: string;
  ativo: boolean;
  padrao: boolean;
  administrador: boolean;
  usuariosAtivos: number;
  versao: number;
  permissoes: readonly { funcionalidade: string; acoes: readonly string[] }[];
};

export type PropsFormPerfil = {
  perfil?: PerfilFormulario; // ausente: cadastro
  grade: readonly ModuloGrade[];
  salvar: AcaoFormulario;
};

const descrito = (campo: string) => ({ 'aria-describedby': `erro-${campo}` });

// Caixa com os três estados (A11): a propriedade `indeterminate` do checkbox nativo, que o leitor de
// tela anuncia como "misto".
function Caixa({ estado, rotulo, desabilitada, aoMudar }: { estado: EstadoCaixa; rotulo?: string; desabilitada?: boolean; aoMudar: (marcada: boolean) => void }) {
  return (
    <input
      type="checkbox"
      ref={(el) => {
        if (el) el.indeterminate = estado === 'indeterminado';
      }}
      checked={estado === 'marcado'}
      disabled={desabilitada}
      aria-label={rotulo}
      onChange={(e) => aoMudar(e.target.checked)}
    />
  );
}

function ModuloDaGrade({ modulo, estado, mudar }: { modulo: ModuloGrade; estado: EstadoGrade; mudar: (e: EstadoGrade) => void }) {
  const colunas = colunasDoModulo(modulo);
  const todasFixas = modulo.funcionalidades.every(ehFixa);
  return (
    <fieldset>
      <legend>
        <label>
          <Caixa estado={estadoModulo(estado, modulo)} desabilitada={todasFixas} aoMudar={(m) => mudar(alternarModulo(estado, modulo, m))} /> {modulo.nome}
        </label>
      </legend>
      <table>
        <caption>{`Permissões do módulo ${modulo.nome}`}</caption>
        <thead>
          <tr>
            <th scope="col">Funcionalidade</th>
            {colunas.map(([acao, rotulo]) => (
              <th key={acao} scope="col">
                {rotulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {modulo.funcionalidades.map((f) => {
            const fixa = ehFixa(f);
            const marcadas = estado.get(f.codigo) ?? new Set<string>();
            return (
              <tr key={f.codigo}>
                <th scope="row">
                  {!fixa && <input type="hidden" name="exibidas" value={f.codigo} />}
                  <label>
                    <Caixa estado={estadoFuncionalidade(estado, f)} desabilitada={fixa} aoMudar={(m) => mudar(alternarFuncionalidade(estado, f, m))} /> {f.nome}
                  </label>
                  {fixa && <span> (Administração, não pode ser alterada)</span>}
                </th>
                {colunas.map(([acao, rotulo]) => (
                  <td key={acao}>
                    {f.acoes.includes(acao) && (
                      <input
                        type="checkbox"
                        // As fixas vão desabilitadas e sem name: não são enviadas, e o servidor não as toca (A2).
                        {...(fixa ? {} : { name: 'permissao', value: `${f.codigo}:${acao}` })}
                        aria-label={`${rotulo} em ${f.nome}`}
                        checked={marcadas.has(acao)}
                        disabled={fixa}
                        onChange={(e) => mudar(alternarAcao(estado, f, acao, e.target.checked))}
                      />
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </fieldset>
  );
}

export function FormPerfil({ perfil, grade, salvar }: PropsFormPerfil) {
  const [estado, setEstado] = useState<EstadoGrade>(() => estadoInicial(grade, perfil?.permissoes ?? []));
  const [ativo, setAtivo] = useState(perfil?.ativo ?? true);
  // E3 (UC02.26): inativar um perfil ativo com usuários ativos pede a confirmação antes de enviar.
  const [confirmando, setConfirmando] = useState(false);
  const [confirmado, setConfirmado] = useState(false);
  const nao = useRef<HTMLButtonElement>(null);
  const radioInativo = useRef<HTMLInputElement>(null);
  const abriu = useRef(false);
  useEffect(() => {
    if (confirmando) {
      abriu.current = true;
      nao.current?.focus();
    } else if (abriu.current) {
      abriu.current = false;
      radioInativo.current?.focus();
    }
  }, [confirmando]);

  // Toda inativação de perfil ativo confirma: com zero usuários ativos na abertura, alguém pode ter
  // associado um depois, e o E3 do servidor voltaria sem caminho para confirmar (revisão do #369).
  const pedeConfirmacao = perfil !== undefined && perfil.ativo;
  const textoConfirmacao = perfil && perfil.usuariosAtivos > 0 ? MENSAGEM_CONFIRMAR_INATIVACAO : MENSAGEM_CONFIRMAR_INATIVACAO_SEM_USUARIOS;
  const escolherStatus = (novo: boolean) => {
    if (!novo && pedeConfirmacao && !confirmado) {
      setConfirmando(true);
      return;
    }
    setAtivo(novo);
  };
  const aviso = precisaAvisoSemEscopo(perfil?.padrao ?? false, paraEntrada(estado, grade).permissoes);

  return (
    <>
      <Formulario acao={salvar}>
        {perfil && (
          <>
            <input type="hidden" name="id" value={perfil.id} />
            <input type="hidden" name="versao" value={perfil.versao} />
          </>
        )}
        <input type="hidden" name="confirmarInativacao" value={confirmado && !ativo ? 'true' : ''} />
        <p>
          <label htmlFor="perfil-nome">Nome</label>
          <input id="perfil-nome" name="nome" defaultValue={perfil?.nome} maxLength={100} required {...descrito('nome')} />
          <ErroDoCampo campo="nome" />
        </p>
        <p>
          <label htmlFor="perfil-descricao">Descrição</label>
          <textarea id="perfil-descricao" name="descricao" defaultValue={perfil?.descricao} maxLength={500} rows={3} {...descrito('descricao')} />
          <ErroDoCampo campo="descricao" />
        </p>
        <fieldset name="ativo">
          <LegendaComErro campo="ativo">Status</LegendaComErro>
          <label>
            <input type="radio" name="ativo" value="true" checked={ativo} onChange={() => escolherStatus(true)} /> Ativo
          </label>
          <label>
            <input ref={radioInativo} type="radio" name="ativo" value="false" checked={!ativo} disabled={perfil?.administrador === true} aria-describedby={perfil?.administrador ? 'perfil-nota-administrador' : undefined} onChange={() => escolherStatus(false)} /> Inativo
          </label>
          {perfil?.administrador && <p id="perfil-nota-administrador">{NOTA_ADMINISTRADOR_ATIVO}</p>}
        </fieldset>
        {confirmando && (
          <div
            role="alertdialog"
            aria-labelledby="perfil-confirmar-inativacao"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setConfirmando(false);
            }}
          >
            <p id="perfil-confirmar-inativacao">{textoConfirmacao}</p>
            <button
              type="button"
              onClick={() => {
                setConfirmado(true);
                setAtivo(false);
                setConfirmando(false);
              }}
            >
              Sim
            </button>
            <button type="button" ref={nao} onClick={() => setConfirmando(false)}>
              Não
            </button>
          </div>
        )}
        <fieldset name="permissoes">
          <LegendaComErro campo="permissoes">Definição de Permissões de Acesso</LegendaComErro>
          {grade.length === 0 && <p>Nenhuma funcionalidade ativa disponível.</p>}
          {grade.map((m) => (
            <ModuloDaGrade key={m.modulo} modulo={m} estado={estado} mudar={setEstado} />
          ))}
          {/* Aviso do C25 (ajuste A3), anunciado pelo leitor de tela quando aparece. */}
          <p aria-live="polite">{aviso ? AVISO_SEM_ESCOPO : null}</p>
        </fieldset>
      </Formulario>
      <p>
        <a href="/adm/perfis">Cancelar</a>
      </p>
    </>
  );
}
