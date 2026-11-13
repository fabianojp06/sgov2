import { acaoAlterarAgrupador, acaoExcluirAgrupador, acaoIncluirAgrupador, Agrupadores, obterTelaAgrupadores } from '@/modules/cad';
import { exigirPagina } from '@/shared/authz';

// Agrupadores de contas (US-047; RF_PLA_REQ_005, RN_PLA_007–011).
export default async function PaginaAgrupadores() {
  const ctx = await exigirPagina('cad.plano_contas', 'consultar');
  const tela = await obterTelaAgrupadores(ctx);
  return (
    <div>
      <h1>Agrupadores de contas</h1>
      <p>
        <a href="/cad/plano-contas">Voltar ao plano de contas</a>
      </p>
      <p>
        Um agrupador reúne contas analíticas sob um nome, para virar uma linha de subtotal nos relatórios. Ele não é conta do plano e não muda o
        plano importado; a mesma conta pode estar em vários agrupadores.
      </p>
      <Agrupadores
        agrupadores={tela.agrupadores}
        contas={tela.contas}
        podeAlterar={ctx.permissoes.has('cad.plano_contas:executar')}
        acoes={{ incluir: acaoIncluirAgrupador, alterar: acaoAlterarAgrupador, excluir: acaoExcluirAgrupador }}
      />
    </div>
  );
}
