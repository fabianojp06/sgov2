'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useFocoDialogo } from './foco-dialogo';
import { MENSAGEM_REDE } from './validar-login';
import { chamarAcao, type RespostaAcaoTela } from './enviar';

export const MENSAGEM_TROCA_OBRIGATORIA = 'A alteração de senha é obrigatória. Não é possível cancelar a operação.';
export const PERGUNTA_TROCA = 'Deseja confirmar a alteração da senha?';

type Dados = { senhaAtual?: string; novaSenha: string; repetirSenha: string };

// Tela de troca de senha (UC02.19). Na troca obrigatória (primeiro acesso), não pede a senha atual
// e não deixa cancelar (A3); na voluntária, pede a senha atual (D-P5-3). A ação vem por props.
export function FormTrocaSenha({
  login,
  obrigatoria,
  trocar,
  confirmando = false,
}: {
  login: string;
  obrigatoria: boolean;
  trocar: (d: Dados) => Promise<RespostaAcaoTela>;
  confirmando?: boolean;
}) {
  const [campos, setCampos] = useState<Dados>({ senhaAtual: '', novaSenha: '', repetirSenha: '' });
  const [erros, setErros] = useState<Record<string, string>>({});
  const [confirmar, setConfirmar] = useState(confirmando);
  const [enviando, iniciar] = useTransition();
  const { origem, nao } = useFocoDialogo(confirmar);

  function pedirConfirmacao(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setConfirmar(true);
  }

  function enviar() {
    setConfirmar(false);
    iniciar(async () => {
      const r = await chamarAcao(trocar, obrigatoria ? { novaSenha: campos.novaSenha, repetirSenha: campos.repetirSenha } : campos);
      if (r === 'rede') setErros({ _: MENSAGEM_REDE });
      else if (!r.ok) setErros(Object.fromEntries(r.erros.map((e) => [e.campo, e.mensagem])));
    });
  }

  const campo = (nome: keyof Dados, rotulo: string, autoComplete: string) => (
    <>
      <label htmlFor={nome}>{rotulo}</label>
      <input
        id={nome}
        name={nome}
        type="password"
        autoComplete={autoComplete}
        value={campos[nome] ?? ''}
        onChange={(e) => setCampos({ ...campos, [nome]: e.target.value })}
        aria-describedby={`${nome}-erro`}
      />
      <span id={`${nome}-erro`} role="alert">
        {erros[nome]}
      </span>
    </>
  );

  return (
    <form onSubmit={pedirConfirmacao} noValidate>
      <label htmlFor="login">Login</label>
      <input id="login" name="login" value={login} disabled readOnly />
      {obrigatoria ? null : campo('senhaAtual', 'Senha atual', 'current-password')}
      {campo('novaSenha', 'Nova senha', 'new-password')}
      {campo('repetirSenha', 'Repetir senha', 'new-password')}
      <p role="alert">{erros._}</p>
      <button type="submit" ref={origem} disabled={enviando}>
        Salvar
      </button>
      <button
        type="button"
        onClick={() => {
          if (obrigatoria) setErros({ _: MENSAGEM_TROCA_OBRIGATORIA });
          else window.location.assign('/inicio');
        }}
      >
        Cancelar
      </button>
      {confirmar ? (
        <div
          role="alertdialog"
          aria-labelledby="troca-pergunta"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setConfirmar(false);
          }}
        >
          <p id="troca-pergunta">{PERGUNTA_TROCA}</p>
          <button type="button" onClick={enviar}>
            Sim
          </button>
          <button type="button" ref={nao} onClick={() => setConfirmar(false)}>
            Não
          </button>
        </div>
      ) : null}
    </form>
  );
}
