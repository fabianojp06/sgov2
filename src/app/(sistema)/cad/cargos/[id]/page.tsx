import { notFound } from 'next/navigation';
import { acaoAlterarCargo, acaoCopiarFaixaParaCargo, FormCargo, listarTabelaSalarial, obterCargo } from '@/modules/cad';
import { exigirPagina } from '@/shared/authz';

// Cargo (US-049 parte 2): os dados do Rubi e os manuais. Os salários, só com a permissão (R24).
export default async function Cargo({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await exigirPagina('cad.cargos', 'consultar');
  const { id } = await params;
  const cargo = await obterCargo(ctx, id);
  if (!cargo) notFound();
  // Alterar exige também ver os salários: o formulário mexe neles (alterarCargo confere de novo).
  const podeAlterar = ctx.permissoes.has('cad.cargos:alterar') && ctx.permissoes.has('cad.salarios:consultar');
  // REQ_TAB_003: as faixas ativas deste cargo, para quem consulta a tabela salarial.
  const faixas = ctx.permissoes.has('cad.tabela_salarial:consultar') ? (await listarTabelaSalarial(ctx, { cargoId: cargo.id })).faixas.filter((f) => f.ativa) : [];
  return (
    <main>
      <h1>
        Cargo {cargo.codigo}: {cargo.nomeOficial}
      </h1>
      <a href="/cad/cargos">Voltar para os cargos</a>
      <FormCargo key={cargo.id} cargo={cargo} podeAlterar={podeAlterar} alterar={acaoAlterarCargo} faixas={faixas} copiarFaixa={acaoCopiarFaixaParaCargo} />
    </main>
  );
}
