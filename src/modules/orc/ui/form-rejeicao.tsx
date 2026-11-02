'use client';

import { ErroDoCampo, Formulario } from '@/modules/ger';
import type { AcaoFormulario } from './acao-confirmada';

// Rejeição pela DIREX (C36): justificativa de pelo menos 15 caracteres. Componente cliente.
export function FormRejeicao({ id, versao, rejeitar }: { id: string; versao: number; rejeitar: AcaoFormulario }) {
  return (
    <Formulario acao={rejeitar} textoEnviar="Rejeitar">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="versao" value={versao} />
      <div>
        <label htmlFor="rejeicao-justificativa">Justificativa da rejeição</label>
        <span id="rejeicao-regra">Pelo menos 15 caracteres.</span>
        <textarea id="rejeicao-justificativa" name="justificativa" required minLength={15} maxLength={1000} aria-describedby="rejeicao-regra erro-justificativa" />
        <ErroDoCampo campo="justificativa" />
      </div>
    </Formulario>
  );
}
