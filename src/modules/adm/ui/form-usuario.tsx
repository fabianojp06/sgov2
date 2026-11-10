'use client';

import { useState } from 'react';
import { AcaoConfirmada, ErroDoCampo, Formulario, type AcaoFormulario } from '@/modules/ger';

// Formulário de cadastro (UC02.12) e alteração (UC02.13) de usuário. Componente cliente: recebe as
// ações e os dados por props da página (não importa o index do módulo, que tem servidor).
// Sem campo de senha (RN0059): a senha é gerada pelo sistema e vai por e-mail.

// RN0052 e UC02.13 A2. [PROVISÓRIAS]: o EP085 não fixa os textos.
export const MENSAGEM_BLOQUEADO = 'Este usuário está bloqueado por excesso de tentativas de acesso sem sucesso.';
const MENSAGEM_SENHA_RESETADA = 'Nova senha gerada e enviada para o e-mail do usuário.';

type FuncionalidadePerfil = { codigo: string; nome: string };
// funcionalidades: as que aceitam exceção (checkbox); fixas: as da Administração, sem checkbox.
type OpcaoPerfil = {
  codigo: string;
  nome: string;
  ativo: boolean;
  funcionalidades?: readonly FuncionalidadePerfil[];
  fixas?: readonly FuncionalidadePerfil[];
};
type OpcaoUnidade = { id: string; nome: string; ativo: boolean };

export type UsuarioFormulario = {
  id: string;
  nome: string;
  email: string;
  login: string;
  ativo: boolean;
  bloqueado: boolean;
  perfis: readonly string[];
  unidades: readonly string[];
  ccEscopo: string | null;
  excecoes?: readonly { perfil: string; funcionalidade: string }[];
  versao: number;
};

export type PropsFormUsuario = {
  usuario?: UsuarioFormulario; // ausente: cadastro
  opcoes: { perfis: readonly OpcaoPerfil[]; unidades: readonly OpcaoUnidade[] };
  salvar: AcaoFormulario;
  resetarSenha?: AcaoFormulario;
  desbloquear?: AcaoFormulario;
};

// Inativo só aparece se já está vinculado (a página manda só esses); fica identificado.
const rotuloOpcao = (nome: string, ativo: boolean) => (ativo ? nome : `${nome} (inativo)`);
const descrito = (campo: string) => ({ 'aria-describedby': `erro-${campo}` });
const chave = (perfil: string, funcionalidade: string) => `${perfil}:${funcionalidade}`;
const semPerfil = (retiradas: ReadonlySet<string>, perfil: string) => new Set([...retiradas].filter((k) => !k.startsWith(`${perfil}:`)));

export function FormUsuario({ usuario, opcoes, salvar, resetarSenha, desbloquear }: PropsFormUsuario) {
  const alteracao = usuario !== undefined;
  const iniciais = new Set(usuario?.perfis ?? []);
  const unidades = new Set(usuario?.unidades ?? []);
  const perfisVisiveis = opcoes.perfis.filter((p) => p.ativo || iniciais.has(p.codigo));
  // Painel "Funcionalidade(s) do Perfil" (US-039; UC02.12 A2, UC02.13 A4–A6): por perfil marcado, as
  // funcionalidades dele, marcadas menos as retiradas do usuário. Desmarcar cria a exceção (REQ0080).
  const [perfis, setPerfis] = useState<ReadonlySet<string>>(iniciais);
  const [retiradas, setRetiradas] = useState<ReadonlySet<string>>(
    () => new Set((usuario?.excecoes ?? []).map((e) => chave(e.perfil, e.funcionalidade))),
  );
  const alternarPerfil = (codigo: string, marcado: boolean) => {
    setPerfis((atual) => (marcado ? new Set([...atual, codigo]) : new Set([...atual].filter((c) => c !== codigo))));
    // Perfil desmarcado perde as exceções (a cascata do banco); marcado de novo, volta todo marcado (A4).
    setRetiradas((atual) => semPerfil(atual, codigo));
  };
  const alternarFuncionalidade = (perfil: OpcaoPerfil, funcionalidade: string, marcada: boolean) => {
    const k = chave(perfil.codigo, funcionalidade);
    const novas = marcada ? new Set([...retiradas].filter((x) => x !== k)) : new Set([...retiradas, k]);
    const todas = perfil.funcionalidades ?? [];
    // REQ0081: todas as funcionalidades desmarcadas desmarcam o perfil (se ele não tiver fixa).
    if (!marcada && (perfil.fixas ?? []).length === 0 && todas.every((f) => novas.has(chave(perfil.codigo, f.codigo)))) {
      alternarPerfil(perfil.codigo, false);
      return;
    }
    setRetiradas(novas);
  };
  const perfisDoPainel = perfisVisiveis.filter((p) => perfis.has(p.codigo));
  const unidadesVisiveis = opcoes.unidades.filter((u) => u.ativo || unidades.has(u.id));

  return (
    <>
      {usuario?.bloqueado && <p>{MENSAGEM_BLOQUEADO}</p>}
      <Formulario acao={salvar}>
        {alteracao && (
          <>
            <input type="hidden" name="id" value={usuario.id} />
            <input type="hidden" name="versao" value={usuario.versao} />
          </>
        )}
        <p>
          <label htmlFor="usuario-nome">Nome completo</label>
          <input id="usuario-nome" name="nome" defaultValue={usuario?.nome} maxLength={120} required {...descrito('nome')} />
          <ErroDoCampo campo="nome" />
        </p>
        <p>
          <label htmlFor="usuario-email">E-mail</label>
          <input id="usuario-email" name="email" type="email" defaultValue={usuario?.email} maxLength={254} required {...descrito('email')} />
          <ErroDoCampo campo="email" />
        </p>
        <p>
          <label htmlFor="usuario-login">Login</label>
          {/* RN0066: login não muda depois do cadastro; o servidor usa o do banco. */}
          <input id="usuario-login" name="login" defaultValue={usuario?.login} maxLength={60} disabled={alteracao} required {...descrito('login')} />
          <ErroDoCampo campo="login" />
        </p>
        <p>
          <label>
            <input type="checkbox" name="ativo" defaultChecked={usuario?.ativo ?? true} {...descrito('ativo')} /> Ativo
          </label>
          <ErroDoCampo campo="ativo" />
        </p>
        <fieldset {...descrito('perfis')}>
          <legend>Perfil de acesso do usuário</legend>
          {perfisVisiveis.map((p) => (
            <label key={p.codigo}>
              <input
                type="checkbox"
                name="perfis"
                value={p.codigo}
                checked={perfis.has(p.codigo)}
                onChange={(e) => alternarPerfil(p.codigo, e.target.checked)}
              />{' '}
              {rotuloOpcao(p.nome, p.ativo)}
            </label>
          ))}
          <ErroDoCampo campo="perfis" />
        </fieldset>
        <fieldset {...descrito('excecoes')}>
          <legend>Funcionalidade(s) do Perfil</legend>
          {perfisDoPainel.length === 0 && <span>Selecione um perfil de acesso para ver as funcionalidades dele.</span>}
          {perfisDoPainel.map((p) => (
            <fieldset key={p.codigo}>
              <legend>{rotuloOpcao(p.nome, p.ativo)}</legend>
              {(p.funcionalidades ?? []).length === 0 && (p.fixas ?? []).length === 0 && <span>Nenhuma funcionalidade neste perfil.</span>}
              {(p.funcionalidades ?? []).map((f) => (
                <label key={f.codigo}>
                  <input type="hidden" name="funcionalidadesExibidas" value={chave(p.codigo, f.codigo)} />
                  <input
                    type="checkbox"
                    name="funcionalidades"
                    value={chave(p.codigo, f.codigo)}
                    checked={!retiradas.has(chave(p.codigo, f.codigo))}
                    onChange={(e) => alternarFuncionalidade(p, f.codigo, e.target.checked)}
                  />{' '}
                  {f.nome}
                </label>
              ))}
              {(p.fixas ?? []).length > 0 && (
                <ul aria-label={`Funcionalidades da Administração do perfil ${p.nome}, que não podem ser retiradas`}>
                  {(p.fixas ?? []).map((f) => (
                    <li key={f.codigo}>{`${f.nome} (Administração, não pode ser retirada)`}</li>
                  ))}
                </ul>
              )}
            </fieldset>
          ))}
          <ErroDoCampo campo="excecoes" />
        </fieldset>
        <fieldset {...descrito('unidades')}>
          <legend>Termos de Parceria</legend>
          {unidadesVisiveis.length === 0 && <span>Nenhum Termo de Parceria cadastrado.</span>}
          {unidadesVisiveis.map((u) => (
            <label key={u.id}>
              <input type="checkbox" name="unidades" value={u.id} defaultChecked={unidades.has(u.id)} /> {rotuloOpcao(u.nome, u.ativo)}
            </label>
          ))}
          <ErroDoCampo campo="unidades" />
        </fieldset>
        <p>
          <label htmlFor="usuario-cc">Centro de custo de escopo (só Gestor de Diretoria)</label>
          <input id="usuario-cc" name="ccEscopo" defaultValue={usuario?.ccEscopo ?? ''} maxLength={60} {...descrito('ccEscopo')} />
          <ErroDoCampo campo="ccEscopo" />
        </p>
      </Formulario>
      <p>
        <a href="/adm/usuarios">Cancelar</a>
      </p>
      {alteracao && resetarSenha && (
        <AcaoConfirmada
          rotulo="Resetar Senha"
          pergunta="Deseja realmente resetar a senha deste usuário?"
          acao={resetarSenha}
          campos={{ id: usuario.id }}
          mensagemSucesso={MENSAGEM_SENHA_RESETADA}
        />
      )}
      {/* RN0063: Desbloquear só para usuário bloqueado e ativo. */}
      {alteracao && desbloquear && usuario.bloqueado && usuario.ativo && (
        <AcaoConfirmada rotulo="Desbloquear" pergunta="Deseja realmente desbloquear este usuário?" acao={desbloquear} campos={{ id: usuario.id }} />
      )}
    </>
  );
}
