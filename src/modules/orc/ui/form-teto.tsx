'use client';

import { ErroDoCampo, Formulario } from '@/modules/ger';
import type { AcaoFormulario } from '@/modules/ger';

// Teto manual do exercício (US-059; D-P6-2). Vazio volta ao teto padrão. Valor no formato
// brasileiro. Componente cliente: a ação e os dados vêm por props da página.
export function FormTeto({
  exercicioId,
  versao,
  tetoManual,
  justificativa,
  salvar,
}: {
  exercicioId: string;
  versao: number;
  tetoManual: string | null;
  justificativa: string | null;
  salvar: AcaoFormulario;
}) {
  return (
    <Formulario acao={salvar} textoEnviar="Gravar teto">
      <input type="hidden" name="exercicioId" value={exercicioId} />
      <input type="hidden" name="versao" value={versao} />
      <p>
        <label htmlFor="teto-valor">Teto manual (R$; vazio = padrão)</label>
        <input id="teto-valor" name="teto" inputMode="decimal" defaultValue={tetoManual ?? ''} aria-describedby="erro-teto" />
        <ErroDoCampo campo="teto" />
      </p>
      <p>
        <label htmlFor="teto-justificativa">Justificativa (obrigatória se o teto passar da receita confirmada)</label>
        <textarea id="teto-justificativa" name="justificativa" maxLength={1000} defaultValue={justificativa ?? ''} aria-describedby="erro-justificativa" />
        <ErroDoCampo campo="justificativa" />
      </p>
    </Formulario>
  );
}
