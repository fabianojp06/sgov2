'use client';

import { AcaoConfirmada, ErroDoCampo, Formulario, type AcaoFormulario } from '@/modules/ger';

// Formulário da alçada (US-042, §11.4). Componente cliente: recebe as ações e os dados por props da
// página. Na alteração, o fluxo é fixo (trocar de fluxo é outra alçada); salvar troca os aprovadores
// (a linha atual é inativada e nasce outra). Só usuários ativos aparecem como opção.
export type AlcadaFormulario = { id: string; fluxo: string; rotuloFluxo: string; titularId: string; substitutoId: string; versao: number };

export type PropsFormAlcada = {
  alcada?: AlcadaFormulario; // ausente: cadastro
  fluxos: readonly { codigo: string; rotulo: string }[];
  usuarios: readonly { id: string; nome: string }[];
  salvar: AcaoFormulario;
  excluir?: AcaoFormulario;
};

const descrito = (campo: string) => ({ 'aria-describedby': `erro-${campo}` });

function Aprovador({ campo, rotulo, valor, usuarios }: { campo: string; rotulo: string; valor: string | undefined; usuarios: PropsFormAlcada['usuarios'] }) {
  return (
    <p>
      <label htmlFor={`alcada-${campo}`}>{rotulo}</label>
      <select id={`alcada-${campo}`} name={campo} defaultValue={valor ?? ''} required {...descrito(campo)}>
        <option value="" disabled>
          Selecione
        </option>
        {usuarios.map((u) => (
          <option key={u.id} value={u.id}>
            {u.nome}
          </option>
        ))}
      </select>
      <ErroDoCampo campo={campo} />
    </p>
  );
}

export function FormAlcada({ alcada, fluxos, usuarios, salvar, excluir }: PropsFormAlcada) {
  return (
    <>
      <Formulario acao={salvar}>
        {alcada ? (
          <>
            <input type="hidden" name="id" value={alcada.id} />
            <input type="hidden" name="versao" value={alcada.versao} />
            <p>{`Fluxo: ${alcada.fluxo} – ${alcada.rotuloFluxo}`}</p>
          </>
        ) : (
          <p>
            <label htmlFor="alcada-fluxo">Fluxo</label>
            <select id="alcada-fluxo" name="fluxo" defaultValue="" required {...descrito('fluxo')}>
              <option value="" disabled>
                Selecione
              </option>
              {fluxos.map((f) => (
                <option key={f.codigo} value={f.codigo}>
                  {`${f.codigo} – ${f.rotulo}`}
                </option>
              ))}
            </select>
            <ErroDoCampo campo="fluxo" />
          </p>
        )}
        <Aprovador campo="titularId" rotulo="Titular" valor={alcada?.titularId} usuarios={usuarios} />
        <Aprovador campo="substitutoId" rotulo="Substituto" valor={alcada?.substitutoId} usuarios={usuarios} />
      </Formulario>
      <p>
        <a href="/adm/alcadas">Cancelar</a>
      </p>
      {/* Pergunta [PROVISÓRIA]: o UC02.28 ainda não foi redigido (GAP-ADM-002). */}
      {alcada && excluir && (
        <AcaoConfirmada rotulo="Excluir" pergunta="Deseja realmente excluir esta alçada?" acao={excluir} campos={{ id: alcada.id, versao: String(alcada.versao) }} />
      )}
    </>
  );
}
