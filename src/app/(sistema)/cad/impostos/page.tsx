import { acaoAlterarImposto, acaoIncluirAliquota, acaoIncluirImposto, acaoRemoverAliquota, Impostos, obterTelaImpostos } from '@/modules/cad';
import { exigirPagina } from '@/shared/authz';

// Impostos e alíquotas com vigência (US-052; UC03.01, REQ_TAX_001).
export default async function PaginaImpostos() {
  const ctx = await exigirPagina('cad.impostos', 'consultar');
  const tela = await obterTelaImpostos(ctx);
  return (
    <div>
      <h1>Impostos e alíquotas</h1>
      <p>
        Cada alíquota vale a partir da competência em que entra e até a próxima. Não se inclui alíquota retroativa, e a que já começou a valer
        não muda: para trocar, inclua uma nova vigência. A proposta oficializada guarda a alíquota que usou.
      </p>
      <Impostos
        mesAtual={tela.mesAtual}
        impostos={tela.impostos}
        podeIncluir={ctx.permissoes.has('cad.impostos:incluir')}
        podeAlterar={ctx.permissoes.has('cad.impostos:alterar')}
        acoes={{ incluir: acaoIncluirImposto, alterar: acaoAlterarImposto, incluirAliquota: acaoIncluirAliquota, removerAliquota: acaoRemoverAliquota }}
      />
    </div>
  );
}
