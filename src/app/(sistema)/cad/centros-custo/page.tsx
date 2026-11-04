import { ArvoreCc, consultarArvoreCentrosCusto, escopoDaSessao } from '@/modules/cad';
import { exigirPagina } from '@/shared/authz';

// Centros de custo em árvore, só leitura (US-046 parte 2). A estrutura muda só pela importação da planilha.
export default async function CentrosCusto() {
  const ctx = await exigirPagina('cad.centros_custo', 'consultar');
  const nos = await consultarArvoreCentrosCusto(ctx);
  return (
    <div>
      <h1>Centros de Custo</h1>
      {ctx.permissoes.has('cad.centros_custo:executar') && <a href="/cad/centros-custo/importar">Importar arquivo</a>}
      <ArvoreCc nos={nos} escopoSessao={escopoDaSessao(ctx)} />
    </div>
  );
}
