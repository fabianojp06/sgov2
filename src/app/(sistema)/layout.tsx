import { unstable_rethrow } from 'next/navigation';
import type { ReactNode } from 'react';
import { AvisoDesativacao, carregarTelaPrincipal, ErroCarregamento, obterAvisoDesativacao, TelaPrincipal, trocarUnidade, type DadosTelaPrincipal } from '@/modules/aut';
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
  // Aviso da desativação do sistema (US-036, D-P9-4). Uma falha aqui não derruba a tela: o componente
  // consulta de novo a cada 30 s.
  let segundos: number | null = null;
  try {
    segundos = (await obterAvisoDesativacao(ctx)).segundos;
  } catch (erro) {
    console.error('[AVISO_DESATIVACAO]', { nome: erro instanceof Error ? erro.name : typeof erro });
  }
  return (
    <TelaPrincipal {...dados} trocarUnidade={trocarUnidade}>
      <AvisoDesativacao segundos={segundos} />
      {children}
    </TelaPrincipal>
  );
}
