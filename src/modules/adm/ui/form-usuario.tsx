'use client';

import { AcaoConfirmada, ErroDoCampo, Formulario, type AcaoFormulario } from '@/modules/ger';

// Formulário de cadastro (UC02.12) e alteração (UC02.13) de usuário. Componente cliente: recebe as
// ações e os dados por props da página (não importa o index do módulo, que tem servidor).
// Sem campo de senha (RN0059): a senha é gerada pelo sistema e vai por e-mail.

// RN0052 e UC02.13 A2. [PROVISÓRIAS]: o EP085 não fixa os textos.
export const MENSAGEM_BLOQUEADO = 'Este usuário está bloqueado por excesso de tentativas de acesso sem sucesso.';
const MENSAGEM_SENHA_RESETADA = 'Nova senha gerada e enviada para o e-mail do usuário.';

type OpcaoPerfil = { codigo: string; nome: string; ativo: boolean };
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

export function FormUsuario({ usuario, opcoes, salvar, resetarSenha, desbloquear }: PropsFormUsuario) {
  const alteracao = usuario !== undefined;
  const perfis = new Set(usuario?.perfis ?? []);
  const unidades = new Set(usuario?.unidades ?? []);
  const perfisVisiveis = opcoes.perfis.filter((p) => p.ativo || perfis.has(p.codigo));
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
              <input type="checkbox" name="perfis" value={p.codigo} defaultChecked={perfis.has(p.codigo)} /> {rotuloOpcao(p.nome, p.ativo)}
            </label>
          ))}
          <ErroDoCampo campo="perfis" />
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
