// Campos da aprovação da DIREX no formulário de importação dos centros de custo (US-046 parte 2;
// R16, GAP-CC-001). Sem estado: vão no mesmo FormData do arquivo. A regra é do caso de uso; aqui
// só o aviso de que, onde a carga provisória vale (CC_CARGA_PROVISORIA=1, fora de produção), deixar
// os dois em branco grava os centros de custo como provisórios.
export function CamposAprovacaoDirex({ provisoriaPermitida }: { provisoriaPermitida: boolean }) {
  return (
    <fieldset>
      <legend>Aprovação da DIREX</legend>
      {provisoriaPermitida ? (
        <p>
          <strong>Carga provisória (minuta).</strong> Sem a data e o documento da aprovação, todos os centros de custo desta carga entram como
          provisórios.
        </p>
      ) : (
        <p>A carga dos centros de custo só acontece depois da aprovação da DIREX: informe a data e o documento.</p>
      )}
      <label htmlFor="aprovacao-data">Data da aprovação</label>{' '}
      <input id="aprovacao-data" type="date" name="aprovacaoData" {...(provisoriaPermitida ? {} : { required: true })} />{' '}
      <label htmlFor="aprovacao-documento">Documento (ata, resolução)</label>{' '}
      <input id="aprovacao-documento" type="text" name="aprovacaoDocumento" maxLength={120} {...(provisoriaPermitida ? {} : { required: true })} />
    </fieldset>
  );
}
