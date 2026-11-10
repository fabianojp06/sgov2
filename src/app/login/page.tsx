import { entrar, FormLogin, solicitarRecuperacaoSenha } from '@/modules/aut';
import { AUSENCIA_SESSAO } from '@/shared/authz';

// C32: o sistema abre no login. A marca é neutra (spec §6.7). Com ?motivo=novo-acesso, a estação
// anterior vê o aviso da RN0519 (US-028); com ?motivo=sistema-inativo, a sessão caiu com a
// desativação do sistema e o login mostra o texto da RN0023 (US-033). Outro valor é ignorado.
const MENSAGEM_DO_MOTIVO: ReadonlyMap<string, string> = new Map(Object.values(AUSENCIA_SESSAO).map((m) => [m.motivoUrl, m.mensagem]));

export default async function Login({ searchParams }: { searchParams: Promise<{ motivo?: string | string[] }> }) {
  const { motivo } = await searchParams;
  const mensagem = typeof motivo === 'string' ? MENSAGEM_DO_MOTIVO.get(motivo) : undefined;
  return (
    <main>
      <h1>SGO 2.0 – Sistema de Gestão Orçamentária</h1>
      {mensagem && <p role="alert">{mensagem}</p>}
      <FormLogin entrar={entrar} recuperar={solicitarRecuperacaoSenha} />
    </main>
  );
}
