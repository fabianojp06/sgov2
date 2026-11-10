import { ArvoreContas, consultarArvoreContas, escopoDaSessao } from '@/modules/cad';
import { exigirPagina } from '@/shared/authz';

// Plano de contas em árvore, só leitura (US-044). A estrutura muda só pela importação da planilha.
export default async function PlanoContas() {
  const ctx = await exigirPagina('cad.plano_contas', 'consultar');
  const nos = await consultarArvoreContas(ctx);
  return (
    <div>
      <h1>Plano de Contas</h1>
      {ctx.permissoes.has('cad.plano_contas:executar') && <a href="/cad/plano-contas/importar">Importar arquivo</a>}
      <ArvoreContas
        nos={nos}
        escopoSessao={escopoDaSessao(ctx)}
        {...(ctx.permissoes.has('cad.plano_contas:exportar') ? { exportar: '/cad/plano-contas/exportar' } : {})}
      />
    </div>
  );
}
