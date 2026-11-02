import { alterarBeneficio, listarBeneficiosMestre, TabelaMestre } from '@/modules/cad';
import { exigirPagina } from '@/shared/authz';

// Tabela Mestre de Benefícios por exercício (US-050). O exercício vem da URL (?ano=2027).
export default async function Beneficios({ searchParams }: { searchParams: Promise<{ ano?: string }> }) {
  const ctx = await exigirPagina('cad.beneficios', 'consultar');
  const { ano: anoTexto } = await searchParams;
  const ano = /^\d{4}$/.test(anoTexto ?? '') ? Number(anoTexto) : 2027;
  const itens = await listarBeneficiosMestre(ctx, ano);
  return (
    <main>
      <h1>Tabela Mestre de Benefícios {ano}</h1>
      <TabelaMestre
        ano={ano}
        podeAlterar={ctx.permissoes.has('cad.beneficios:alterar')}
        alterar={alterarBeneficio}
        itens={itens.map((i) => ({
          codigo: i.codigo,
          nome: i.nome,
          forma: i.forma,
          valor: i.valor?.paraString() ?? null,
          percentual: i.percentual?.paraString() ?? null,
          conta: i.conta,
          padraoPosicao: i.padraoPosicao,
          ativo: i.ativo,
          provisorio: i.provisorio,
          versao: i.versao,
        }))}
      />
    </main>
  );
}
