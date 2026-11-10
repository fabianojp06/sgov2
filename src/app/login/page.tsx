import { entrar, FormLogin, solicitarRecuperacaoSenha } from '@/modules/aut';
import { MENSAGEM_SESSAO_NOVO_ACESSO } from '@/shared/authz';

// C32: o sistema abre no login. A marca é neutra (spec §6.7). Com ?motivo=novo-acesso, a estação
// anterior vê o aviso da RN0519 (US-028); outro valor é ignorado.
export default async function Login({ searchParams }: { searchParams: Promise<{ motivo?: string | string[] }> }) {
  const { motivo } = await searchParams;
  return (
    <main>
      <h1>SGO 2.0 – Sistema de Gestão Orçamentária</h1>
      {motivo === 'novo-acesso' && <p role="alert">{MENSAGEM_SESSAO_NOVO_ACESSO}</p>}
      <FormLogin entrar={entrar} recuperar={solicitarRecuperacaoSenha} />
    </main>
  );
}
