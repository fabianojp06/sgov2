import { PergunteSgo, perguntarAoSgoAcao, pergunteLiberado } from '@/modules/rel';
import { exigirPagina } from '@/shared/authz';

// Pergunte ao SGO (US-104, IA-16): com a IA ligada para o perfil, a pergunta em linguagem comum e a resposta
// com o número do sistema, a fonte e o link, dentro das permissões de quem pergunta.
export default async function Pergunte() {
  const ctx = await exigirPagina('rel.pergunte_sgo', 'consultar');
  const liberado = (await pergunteLiberado(ctx)) && ctx.permissoes.has('rel.pergunte_sgo:executar');
  return (
    <div>
      <h1>Pergunte ao SGO</h1>
      <p>
        Pergunte, por exemplo: &quot;qual o orçamento da Administração Central em 2027?&quot;, &quot;quanto o centro de custo 4.3.2 orçou?&quot; ou
        &quot;qual o Valor Global do TP-001/2027?&quot;. Por enquanto respondo sobre o orçamento da Administração Central e os Termos de Parceria;
        os relatórios de execução entram quando houver o realizado.
      </p>
      {liberado ? <PergunteSgo perguntar={perguntarAoSgoAcao} /> : <p>A IA está desligada para esta função. O Administrador liga em Cadastros › Inteligência artificial.</p>}
    </div>
  );
}
