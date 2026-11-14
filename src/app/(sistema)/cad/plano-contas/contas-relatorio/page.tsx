import { acaoAlterarContasRelatorio, FormContasRelatorio, obterTelaContasRelatorio } from '@/modules/cad';
import { exigirPagina } from '@/shared/authz';

// Contas dos relatórios (US-097; decisão do PO no #119): as sintéticas de viagens e diárias (UC05.03) e do
// Imobilizado/Intangível (UC05.04). Parametrização local: a estrutura do plano de contas não muda aqui.
export default async function ContasRelatorio() {
  const ctx = await exigirPagina('cad.plano_contas', 'consultar');
  const { papeis, sinteticas } = await obterTelaContasRelatorio(ctx);
  const podeAlterar = ctx.permissoes.has('cad.plano_contas:executar');
  return (
    <div>
      <h1>Contas dos relatórios</h1>
      <p>
        <a href="/cad/plano-contas">Voltar ao plano de contas</a>
      </p>
      <p>
        Marque as contas sintéticas que cada relatório usa. O relatório mostra as contas analíticas abaixo delas. A estrutura do plano de contas
        não muda aqui.
      </p>
      {papeis.map((p) => (
        <FormContasRelatorio key={p.papel} papel={p} sinteticas={sinteticas} podeAlterar={podeAlterar} alterar={acaoAlterarContasRelatorio} />
      ))}
    </div>
  );
}
