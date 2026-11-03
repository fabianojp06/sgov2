import { notFound } from "next/navigation";
import {
  acaoAlterarBeneficiosCargo,
  acaoAlterarCargo,
  acaoCopiarFaixaParaCargo,
  BlocoEncargo,
  calcularCustoCargo,
  FormCargo,
  listarBeneficiosCargo,
  listarTabelaSalarial,
  obterCargo,
  paraTelaCusto,
} from "@/modules/cad";
import { exigirPagina } from "@/shared/authz";

// Cargo (US-049 parte 2): os dados do Rubi e os manuais. Os salários, só com a permissão (R24).
export default async function Cargo({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await exigirPagina("cad.cargos", "consultar");
  const { id } = await params;
  const cargo = await obterCargo(ctx, id);
  if (!cargo) notFound();
  // Alterar exige também ver os salários: o formulário mexe neles (alterarCargo confere de novo).
  const podeAlterar =
    ctx.permissoes.has("cad.cargos:alterar") &&
    ctx.permissoes.has("cad.salarios:consultar");
  // REQ_TAB_003: as faixas ativas deste cargo, para quem consulta a tabela salarial.
  const faixas = ctx.permissoes.has("cad.tabela_salarial:consultar")
    ? (await listarTabelaSalarial(ctx, { cargoId: cargo.id })).faixas.filter(
        (f) => f.ativa,
      )
    : [];
  // Benefícios do cargo no exercício mais recente (US-050 parte 2).
  const b = await listarBeneficiosCargo(ctx, cargo.id, null);
  // Custo de 1 pessoa no mesmo exercício pelo MotorCustoPessoal (US-051 parte 2).
  const custo =
    b.ano === null
      ? null
      : paraTelaCusto(await calcularCustoCargo(ctx, cargo.id, b.ano));
  return (
    <main>
      <h1>
        Cargo {cargo.codigo}: {cargo.nomeOficial}
      </h1>
      <a href="/cad/cargos">Voltar para os cargos</a>
      <FormCargo
        key={cargo.id}
        cargo={cargo}
        podeAlterar={podeAlterar}
        alterar={acaoAlterarCargo}
        faixas={faixas}
        copiarFaixa={acaoCopiarFaixaParaCargo}
        beneficios={b.ano === null ? null : { ano: b.ano, itens: b.itens }}
        alterarBeneficios={acaoAlterarBeneficiosCargo}
      />
      {custo && b.ano !== null && <BlocoEncargo custo={custo} ano={b.ano} />}
    </main>
  );
}
