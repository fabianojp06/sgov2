import { acaoAlterarNomeExibicao, FormInstituicao, obterTelaInstituicao } from '@/modules/cad';
import { exigirPagina } from '@/shared/authz';

// Nome de exibição da instituição (#434; spec §6.7).
export default async function Instituicao() {
  const ctx = await exigirPagina('cad.instituicao', 'consultar');
  const tela = await obterTelaInstituicao(ctx);
  return (
    <div>
      <h1>Instituição</h1>
      <FormInstituicao nome={tela.nome} podeAlterar={ctx.permissoes.has('cad.instituicao:alterar')} alterar={acaoAlterarNomeExibicao} />
    </div>
  );
}
