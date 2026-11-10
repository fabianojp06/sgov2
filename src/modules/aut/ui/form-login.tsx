'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { aoCancelar, enviarLogin, MENSAGEM_REDE, validarCampos, type CamposLogin, type RespostaLogin } from './validar-login';

// Tela de login (UC01.01). Os campos ficam só na memória do componente (RNF0002); a senha é
// mascarada (RN0515). A ação vem do servidor por props, para a tela não importar código de servidor.
// Esqueci minha senha (US-029): usa o login digitado; a resposta (sempre a mesma, RN0516) aparece
// em role="status".
export function FormLogin({
  entrar,
  recuperar,
}: {
  entrar: (dados: CamposLogin) => Promise<RespostaLogin>;
  recuperar?: (dados: { login: string }) => Promise<{ ok: true; valor: { mensagem: string } } | { ok: false; erros: readonly { mensagem: string }[] }>;
}) {
  const [campos, setCampos] = useState<CamposLogin>({ login: '', senha: '' });
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();
  const [recuperacao, setRecuperacao] = useState<string | null>(null);

  function pedirNovaSenha() {
    setRecuperacao(null);
    if (!recuperar) return;
    if (campos.login.trim() === '') {
      setMensagem('O campo Login é obrigatório para redefinir a senha');
      return;
    }
    iniciar(async () => {
      try {
        const r = await recuperar({ login: campos.login });
        setMensagem(null);
        setRecuperacao(r.ok ? r.valor.mensagem : (r.erros[0]?.mensagem ?? null));
      } catch {
        setMensagem(MENSAGEM_REDE);
      }
    });
  }

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const erro = validarCampos(campos.login, campos.senha);
    setAviso(null);
    if (erro) {
      setMensagem(erro);
      return;
    }
    iniciar(async () => {
      // Sucesso: a ação redireciona (o erro de redirect segue adiante em enviarLogin).
      const r = await enviarLogin(entrar, campos);
      setMensagem(r.mensagem);
      setAviso(r.aviso);
      setCampos(r.campos);
    });
  }

  return (
    <form onSubmit={enviar} noValidate aria-describedby="mensagem-login" className="form-login">
      <label htmlFor="login">Login</label>
      <input
        id="login"
        name="login"
        autoComplete="username"
        value={campos.login}
        onChange={(e) => setCampos({ ...campos, login: e.target.value })}
      />
      <label htmlFor="senha">Senha</label>
      <input
        id="senha"
        name="senha"
        type="password"
        autoComplete="current-password"
        value={campos.senha}
        onChange={(e) => setCampos({ ...campos, senha: e.target.value })}
      />
      <p id="mensagem-login" role="alert">
        {mensagem}
        {aviso ? <><br />{aviso}</> : null}
      </p>
      <button type="submit" disabled={enviando}>Entrar</button>
      <button
        type="button"
        onClick={() => {
          setCampos(aoCancelar());
          setMensagem(null);
          setAviso(null);
        }}
      >
        Cancelar
      </button>
      {recuperar && (
        <button type="button" onClick={pedirNovaSenha} disabled={enviando}>
          Esqueci minha senha
        </button>
      )}
      <p role="status">{recuperacao}</p>
    </form>
  );
}
