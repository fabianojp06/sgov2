import { BotaoSair, FormTrocaSenha, trocar } from '@/modules/aut';
import { exigirPagina } from '@/shared/authz';

// Troca de senha (US-030): obrigatória no primeiro acesso (REQ0039) ou voluntária.
export default async function TrocaSenha() {
  const ctx = await exigirPagina('aut.senha', 'alterar');
  return (
    <main>
      <h1>Alterar senha</h1>
      <FormTrocaSenha login={ctx.usuarioRotulo} obrigatoria={ctx.trocaSenhaPendente === true} trocar={trocar} />
      <BotaoSair />
    </main>
  );
}
