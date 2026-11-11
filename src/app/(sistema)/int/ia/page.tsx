import { acaoAlterarCasoUsoIA, acaoAlterarConfiguracaoIA, CadastroIA, obterTelaIA } from '@/modules/int';
import { exigirPagina } from '@/shared/authz';

// Cadastro da IA (US-019 parte 2, spec §4.4): chave geral, limites, casos de uso e consumo do mês.
export default async function InteligenciaArtificial() {
  const ctx = await exigirPagina('int.ia', 'consultar');
  const tela = await obterTelaIA(ctx);
  return (
    <CadastroIA
      tela={tela}
      podeAlterar={ctx.permissoes.has('int.ia:alterar')}
      alterarConfiguracao={acaoAlterarConfiguracaoIA}
      alterarCaso={acaoAlterarCasoUsoIA}
    />
  );
}
