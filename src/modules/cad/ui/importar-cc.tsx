'use client';

import { useErrosDoCampo } from './importar-estrutura';

// Campos da aprovação da DIREX no formulário de importação dos centros de custo (US-046 parte 2;
// R16, GAP-CC-001). Vão no mesmo FormData do arquivo; a regra é do caso de uso, que devolve os erros
// em aprovacao, aprovacao.data e aprovacao.documento, mostrados aqui ao lado de cada campo. Onde a
// carga provisória vale (CC_CARGA_PROVISORIA=1, fora de produção), os dois em branco gravam os centros
// de custo como provisórios.
export function CamposAprovacaoDirex({ provisoriaPermitida }: { provisoriaPermitida: boolean }) {
  const geral = useErrosDoCampo('aprovacao');
  return (
    <fieldset {...(geral.length > 0 ? { 'aria-describedby': 'aprovacao-erro' } : {})}>
      <legend>Aprovação da DIREX</legend>
      {provisoriaPermitida ? (
        <p>
          <strong>Carga provisória (minuta).</strong> Sem a data e o documento da aprovação, todos os centros de custo desta carga entram como
          provisórios.
        </p>
      ) : (
        <p>A carga dos centros de custo só acontece depois da aprovação da DIREX: informe a data e o documento.</p>
      )}
      {geral.length > 0 && <p id="aprovacao-erro">{geral.join(' ')}</p>}
      <Campo id="aprovacao-data" campo="aprovacao.data" nome="aprovacaoData" rotulo="Aprovado pela DIREX em" tipo="date" obrigatorio={!provisoriaPermitida} />{' '}
      <Campo
        id="aprovacao-documento"
        campo="aprovacao.documento"
        nome="aprovacaoDocumento"
        rotulo="Documento de aprovação (ata, resolução)"
        tipo="text"
        obrigatorio={!provisoriaPermitida}
      />
    </fieldset>
  );
}

// aria-required, não required: o formulário é noValidate e quem decide é o servidor.
function Campo({ id, campo, nome, rotulo, tipo, obrigatorio }: { id: string; campo: string; nome: string; rotulo: string; tipo: 'date' | 'text'; obrigatorio: boolean }) {
  const erros = useErrosDoCampo(campo);
  return (
    <span>
      <label htmlFor={id}>{rotulo}</label>{' '}
      <input
        id={id}
        type={tipo}
        name={nome}
        {...(tipo === 'text' ? { maxLength: 120 } : {})}
        {...(obrigatorio ? { 'aria-required': true } : {})}
        {...(erros.length > 0 ? { 'aria-invalid': true, 'aria-describedby': `${id}-erro` } : {})}
      />
      {erros.length > 0 && <span id={`${id}-erro`}>{erros.join(' ')}</span>}
    </span>
  );
}
