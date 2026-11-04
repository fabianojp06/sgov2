import {
  acaoAlterarFaixa,
  acaoIncluirFaixa,
  acaoIncluirSenioridade,
  acaoInativarFaixa,
  acaoInativarSenioridade,
  listarOpcoesCargos,
  listarTabelaSalarial,
  TabelaSalarial,
} from '@/modules/cad';
import { exigirPagina } from '@/shared/authz';

// Tabela salarial de mercado por cargo e senioridade (US-049 parte 3; UC03.19 §5). ?cargo=<id> filtra.
export default async function TabelaSalarialPagina({ searchParams }: { searchParams: Promise<{ cargo?: string }> }) {
  const ctx = await exigirPagina('cad.tabela_salarial', 'consultar');
  const { cargo } = await searchParams;
  const { faixas, senioridades } = await listarTabelaSalarial(ctx, cargo ? { cargoId: cargo } : {});
  const cargos = await listarOpcoesCargos(ctx);
  const pode = (a: string) => ctx.permissoes.has(`cad.tabela_salarial:${a}`);
  return (
    <div>
      <h1>Tabela Salarial</h1>
      <p>Referência de mercado (pesquisa externa) por cargo e senioridade, sem vínculo com a tabela, a faixa e o nível do Rubi.</p>
      <TabelaSalarial
        faixas={faixas}
        senioridades={senioridades}
        cargos={cargos}
        podeIncluir={pode('incluir')}
        podeAlterar={pode('alterar')}
        podeExcluir={pode('excluir')}
        incluirFaixa={acaoIncluirFaixa}
        alterarFaixa={acaoAlterarFaixa}
        inativarFaixa={acaoInativarFaixa}
        incluirSenioridade={acaoIncluirSenioridade}
        inativarSenioridade={acaoInativarSenioridade}
      />
    </div>
  );
}
