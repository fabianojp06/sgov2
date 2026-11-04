import { acaoConsultarCargaCc, acaoImportarCentrosCusto, CamposAprovacaoDirex, cargaProvisoriaPermitida, ImportarEstrutura } from '@/modules/cad';
import { exigirPagina } from '@/shared/authz';

// Importação dos centros de custo por planilha .xlsx (US-046 parte 2), com a aprovação da DIREX
// (R16, GAP-CC-001). A carga é do worker; a tela acompanha o lote até o fim.
export default async function ImportarCentrosCusto() {
  await exigirPagina('cad.centros_custo', 'executar');
  return (
    <div>
      <h1>Importar os centros de custo</h1>
      <p>
        Envie a planilha .xlsx do plano de centros de custo, de até 1 MB. Qualquer erro reprova o arquivo inteiro, e nada é gravado até a
        importação terminar sem erros.
      </p>
      <ImportarEstrutura rotulo="Planilha dos centros de custo (.xlsx)" importar={acaoImportarCentrosCusto} consultar={acaoConsultarCargaCc}>
        <CamposAprovacaoDirex provisoriaPermitida={cargaProvisoriaPermitida(process.env, { registrar: false })} />
      </ImportarEstrutura>
    </div>
  );
}
