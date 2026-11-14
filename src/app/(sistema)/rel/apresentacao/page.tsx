import { Apresentacao, apresentacaoLiberada, exportarSlidesAcao, gerarRoteiroAcao } from '@/modules/rel';
import { exigirPagina } from '@/shared/authz';

// Roteiro de apresentação para reunião de diretoria (US-105, IA-15): com a IA ligada para o perfil, o tema,
// o roteiro e os slides em PDF.
export default async function ApresentacaoDiretoria() {
  const ctx = await exigirPagina('rel.apresentacao_diretoria', 'consultar');
  const liberada = (await apresentacaoLiberada(ctx)) && ctx.permissoes.has('rel.apresentacao_diretoria:executar');
  return (
    <div>
      <h1>Apresentação para reunião de diretoria</h1>
      <p>
        Escreva o tema da reunião (por exemplo, &quot;orçamento 2027 da Administração Central&quot;). A IA monta o roteiro dos slides com os dados
        consolidados do sistema; os gráficos são desenhados pelo sistema. Revise antes de apresentar.
      </p>
      {liberada ? (
        <Apresentacao gerar={gerarRoteiroAcao} exportar={exportarSlidesAcao} podeExportar={ctx.permissoes.has('rel.apresentacao_diretoria:exportar')} />
      ) : (
        <p>A IA está desligada para esta função. O Administrador liga em Cadastros › Inteligência artificial.</p>
      )}
    </div>
  );
}
