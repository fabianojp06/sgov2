import { acaoDefinirSituacaoUnidade, acaoIncluirUnidade, acaoRenomearUnidade, EstruturaFuncional, obterTelaEstruturaFuncional } from '@/modules/cad';
import { exigirPagina } from '@/shared/authz';

// Estrutura funcional (US-048; UC03.18): a árvore de unidades e os cargos vinculados a cada unidade analítica.
export default async function PaginaEstruturaFuncional() {
  const ctx = await exigirPagina('cad.estrutura_funcional', 'consultar');
  const tela = await obterTelaEstruturaFuncional(ctx);
  return (
    <div>
      <h1>Estrutura funcional</h1>
      <p>
        Diretoria e Gerência consolidam (sintéticas); Assessoria, Coordenadoria e Setor recebem os cargos (analíticas). A Assessoria fica sob uma
        Diretoria; a Coordenadoria e o Setor, sob uma Gerência.
      </p>
      <EstruturaFuncional
        arvore={tela.arvore}
        ocupacao={tela.ocupacao}
        podeIncluir={ctx.permissoes.has('cad.estrutura_funcional:incluir')}
        podeAlterar={ctx.permissoes.has('cad.estrutura_funcional:alterar')}
        acoes={{ incluir: acaoIncluirUnidade, renomear: acaoRenomearUnidade, definirSituacao: acaoDefinirSituacaoUnidade }}
      />
    </div>
  );
}
