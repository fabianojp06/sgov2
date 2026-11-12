'use client';

import { useState } from 'react';
import { AcaoConfirmada, type AcaoFormulario } from '@/modules/ger';
import { Dinheiro } from '@/shared/kernel';
import type { ItemCorrespondencia } from '../application/correspondencia-cargos';
import type { CargosPosicao, OpcaoCargo } from '../application/posicoes';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { valorParaTela } from '../domain/valor-tela';

// Escolha do cargo do cadastro para um texto da tela de correspondência (P16, Task 2): a sugestão vem
// pré-escolhida (D-P16-3) e a ligação passa pela confirmação. A Fonte Ativa só aparece no rótulo com
// cargos.comSalario (D-P16-4, R24).
const rotulo = (c: OpcaoCargo, comSalario: boolean) =>
  `${c.codigo} – ${c.nome}${comSalario && c.salarioFonteAtiva ? ` · Fonte Ativa R$ ${valorParaTela(Dinheiro.de(c.salarioFonteAtiva))}` : ''}`;

export function LigarCargo({
  item,
  exercicioId,
  versao,
  cargos,
  acao,
}: {
  item: ItemCorrespondencia;
  exercicioId: string;
  versao: number;
  cargos: CargosPosicao;
  acao: AcaoFormulario;
}) {
  const [cargoId, setCargoId] = useState(item.sugestaoId ?? '');
  const escolhido = cargos.cargos.find((c) => c.id === cargoId);
  const nomeBotao = `Ligar ${item.texto}`;
  return (
    <>
      <select aria-label={`Cargo do cadastro para ${item.texto}`} value={cargoId} onChange={(ev) => setCargoId(ev.target.value)}>
        <option value="">{MENSAGENS_ORC.CARGO_ESCOLHA}</option>
        {cargos.cargos.map((c) => (
          <option key={c.id} value={c.id}>
            {rotulo(c, cargos.comSalario)}
          </option>
        ))}
      </select>{' '}
      {escolhido ? (
        <AcaoConfirmada
          key={escolhido.id}
          rotulo={nomeBotao}
          pergunta={MENSAGENS_ORC.CONFIRMA_LIGAR_CARGO(item.texto, item.posicoes, escolhido.nome)}
          acao={acao}
          campos={{ exercicioId, texto: item.texto, cargoId: escolhido.id, versao: String(versao) }}
        />
      ) : (
        <button type="button" disabled>
          {nomeBotao}
        </button>
      )}
    </>
  );
}
