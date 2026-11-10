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
      {ctx.permissoes.has('cad.centros_custo:exportar') && (
        <p>
          Exportar: <a href="/cad/centros-custo/exportar?formato=xlsx">XLSX</a> · <a href="/cad/centros-custo/exportar?formato=csv">CSV</a> (com os inativos: <a href="/cad/centros-custo/exportar?formato=xlsx&inativos=1">XLSX</a> ·{' '}
          <a href="/cad/centros-custo/exportar?formato=csv&inativos=1">CSV</a>)
        </p>
      )}
      <ArvoreCc nos={nos} escopoSessao={escopoDaSessao(ctx)} />
    </div>
  );
}
