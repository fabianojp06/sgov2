import { unstable_rethrow } from 'next/navigation';
import type { ReactNode } from 'react';
import { carregarTelaPrincipal, ErroCarregamento, TelaPrincipal, trocarUnidade, type DadosTelaPrincipal } from '@/modules/aut';
import { exigirPagina } from '@/shared/authz';
import type { ContextoRequisicao } from '@/shared/authz';

// Layout da área logada (US-031). A guarda daqui não substitui a de cada página (o App Router não
// renderiza o layout de novo na navegação entre páginas irmãs); ela monta a tela principal.
export default async function LayoutSistema({ children }: { children: ReactNode }) {
  let ctx: ContextoRequisicao;
  try {
    ctx = await exigirPagina('aut.tela_principal', 'consultar');
  } catch (erro) {
    unstable_rethrow(erro);
    console.error('[TELA_PRINCIPAL_PERMISSOES]', { nome: erro instanceof Error ? erro.name : typeof erro });
    return <ErroCarregamento tipo="permissoes" />;
  }
  let dados: DadosTelaPrincipal;
  try {
    dados = await carregarTelaPrincipal(ctx);
  } catch (erro) {
    console.error('[TELA_PRINCIPAL_MODULOS]', { nome: erro instanceof Error ? erro.name : typeof erro });
    return <ErroCarregamento tipo="modulos" />;
  }
  return (
    <TelaPrincipal {...dados} trocarUnidade={trocarUnidade}>
      {children}
    </TelaPrincipal>
  );
}
