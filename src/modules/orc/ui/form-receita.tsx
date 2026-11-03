'use client';

import { ErroDoCampo, Formulario } from '@/modules/ger';
import type { AcaoFormulario } from './acao-confirmada';

// Receita do rateio de um TP, digitada pela GFIN na transição (US-060; C35). Valores no formato
// brasileiro (1.234,56). Componente cliente: a ação e os dados vêm por props da página.
const MESES = [
  ['jan', 'Janeiro'],
  ['fev', 'Fevereiro'],
  ['mar', 'Março'],
  ['abr', 'Abril'],
  ['mai', 'Maio'],
  ['jun', 'Junho'],
  ['jul', 'Julho'],
  ['ago', 'Agosto'],
  ['set', 'Setembro'],
  ['out', 'Outubro'],
  ['nov', 'Novembro'],
  ['dez', 'Dezembro'],
] as const;

export type ReceitaFormulario = { id: string; tp: string; descricao: string; situacao: string; meses: readonly string[]; versao: number };

export function FormReceita({
  ano,
  exercicioId,
  receita,
  salvar,
}: {
  ano: number;
  exercicioId?: string;
  receita?: ReceitaFormulario;
  salvar: AcaoFormulario;
}) {
  const situacao = receita?.situacao ?? 'CONFIRMADO';
  return (
    <Formulario acao={salvar} textoEnviar="Salvar">
      {receita ? (
        <>
          <input type="hidden" name="id" value={receita.id} />
          <input type="hidden" name="versao" value={receita.versao} />
        </>
      ) : (
        <input type="hidden" name="exercicioId" value={exercicioId} />
      )}
      <p>
        <label htmlFor="receita-tp">TP / versão</label>
        <input id="receita-tp" name="tp" maxLength={60} defaultValue={receita?.tp ?? ''} required aria-describedby="erro-tp" />
        <ErroDoCampo campo="tp" />
      </p>
      <p>
        <label htmlFor="receita-descricao">Descrição</label>
        <input id="receita-descricao" name="descricao" maxLength={200} defaultValue={receita?.descricao ?? ''} aria-describedby="erro-descricao" />
        <ErroDoCampo campo="descricao" />
      </p>
      <fieldset aria-describedby="erro-situacao">
        <legend>Situação</legend>
        <label>
          <input type="radio" name="situacao" value="Confirmado" defaultChecked={situacao === 'CONFIRMADO'} /> Confirmado (TP oficializado)
        </label>
        <label>
          <input type="radio" name="situacao" value="Previsto" defaultChecked={situacao === 'PREVISTO'} /> Previsto (proposta em aprovação; fora do saldo e do teto)
        </label>
        <ErroDoCampo campo="situacao" />
      </fieldset>
      <fieldset>
        <legend>{`Rateio mês a mês em ${ano} (R$)`}</legend>
        {MESES.map(([nome, rotulo], i) => (
          <p key={nome}>
            <label htmlFor={`receita-${nome}`}>{rotulo}</label>
            <input
              id={`receita-${nome}`}
              name={nome}
              inputMode="decimal"
              defaultValue={receita?.meses[i] ?? ''}
              placeholder="0,00"
              aria-describedby={`erro-${nome}`}
            />
            <ErroDoCampo campo={nome} />
          </p>
        ))}
      </fieldset>
      <a href={`/orc/receitas?ano=${ano}`}>Cancelar</a>
    </Formulario>
  );
}
