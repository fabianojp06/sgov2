import { acaoAlterarCasoUsoIA, acaoAlterarConfiguracaoIA, CadastroIA, obterTelaIA } from '@/modules/int';
import { exigirPagina } from '@/shared/authz';

// Cadastro da IA (US-019 parte 2, spec §4.4): chave geral, limites, casos de uso e consumo do mês.
// O caso de uso em edição vem da URL (?caso=cad.sugerir_conta).
export default async function InteligenciaArtificial({ searchParams }: { searchParams: Promise<{ caso?: string | string[] }> }) {
  const ctx = await exigirPagina('int.ia', 'consultar');
  const { caso } = await searchParams;
  const tela = await obterTelaIA(ctx);
  return (
    <CadastroIA
      tela={tela}
      editando={typeof caso === 'string' ? caso : null}
      podeAlterar={ctx.permissoes.has('int.ia:alterar')}
      alterarConfiguracao={acaoAlterarConfiguracaoIA}
      alterarCaso={acaoAlterarCasoUsoIA}
    />
  );
}
