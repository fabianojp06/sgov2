import { alterarBeneficio, incluirBeneficio, listarAnosBeneficios, listarBeneficiosMestre, SeletorAno, TabelaMestre } from '@/modules/cad';
import { exigirPagina } from '@/shared/authz';

// Tabela Mestre de Benefícios por exercício (US-050). O exercício vem da URL (?ano=2027); sem ele, o
// mais recente com parâmetros.
export default async function Beneficios({ searchParams }: { searchParams: Promise<{ ano?: string }> }) {
  const ctx = await exigirPagina('cad.beneficios', 'consultar');
  const { ano: anoTexto } = await searchParams;
  const anos = await listarAnosBeneficios(ctx);
  const ano = /^\d{4}$/.test(anoTexto ?? '') ? Number(anoTexto) : (anos[0] ?? null);
  if (ano === null) {
    return (
      <div>
        <h1>Tabela Mestre de Benefícios</h1>
        <p>Nenhum exercício tem parâmetros ainda.</p>
      </div>
    );
  }
  const itens = await listarBeneficiosMestre(ctx, ano);
  // Sem os parâmetros do ano, não há onde gravar: a inclusão fica escondida.
  const temParametros = anos.includes(ano);
  return (
    <div>
      <h1>Tabela Mestre de Benefícios {ano}</h1>
      <SeletorAno acao="/cad/beneficios" anos={anos} ano={ano} />
      {!temParametros && <p>O exercício {ano} não tem parâmetros.</p>}
      <TabelaMestre
        key={ano}
        ano={ano}
        podeAlterar={ctx.permissoes.has('cad.beneficios:alterar')}
        alterar={alterarBeneficio}
        podeIncluir={temParametros && ctx.permissoes.has('cad.beneficios:incluir')}
        incluir={incluirBeneficio}
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
    </div>
  );
}
