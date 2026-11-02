import { acaoConsultarCargaPlano, acaoImportarPlanoContas, ImportarEstrutura } from '@/modules/cad';
import { exigirPagina } from '@/shared/authz';

// Importação do plano de contas por planilha .xlsx (US-043 parte 4). A carga é do worker; a tela
// acompanha o lote até o fim.
export default async function ImportarPlanoContas() {
  await exigirPagina('cad.plano_contas', 'executar');
  return (
    <main>
      <h1>Importar o plano de contas</h1>
      <p>
        Envie a planilha .xlsx com a aba &quot;Plano de Contas&quot;, de até 1 MB. Qualquer erro reprova o arquivo inteiro, e nada é
        gravado até a importação terminar sem erros.
      </p>
      <ImportarEstrutura rotulo="Planilha do plano de contas (.xlsx)" importar={acaoImportarPlanoContas} consultar={acaoConsultarCargaPlano} />
    </main>
  );
}
