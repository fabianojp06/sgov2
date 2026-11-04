import { acaoConsultarCargaCargos, acaoImportarCargos, ImportarEstrutura } from '@/modules/cad';
import { exigirPagina } from '@/shared/authz';

// Importação dos cargos do Rubi (US-049; R20, layout CAD-CARGOS v1.0). O salário real é cifrado pelo
// app; a carga é do worker, e a tela acompanha o lote até o fim.
export default async function ImportarCargos() {
  await exigirPagina('cad.cargos', 'executar');
  return (
    <div>
      <h1>Importar os cargos do Rubi</h1>
      <p>
        Envie a planilha .xlsx no layout CAD-CARGOS v1.0, de até 1 MB. Qualquer erro reprova o arquivo inteiro. Os campos manuais dos cargos
        (mercado, fonte ativa, adicional) não mudam; o cargo que saiu do arquivo fica inativo.
      </p>
      <ImportarEstrutura rotulo="Planilha dos cargos (.xlsx)" importar={acaoImportarCargos} consultar={acaoConsultarCargaCargos} />
    </div>
  );
}
