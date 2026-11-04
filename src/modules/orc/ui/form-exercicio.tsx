'use client';

import { ErroDoCampo, Formulario } from '@/modules/ger';
import type { AcaoFormulario } from '@/modules/ger';

// Novo exercício (US-055, §6.6): ano (padrão: o seguinte ao último) e a forma de início, em branco
// ou copiando o exercício anterior. Componente cliente: a ação vem por props da página.
export function FormExercicio({ anoPadrao, criar }: { anoPadrao: number; criar: AcaoFormulario }) {
  return (
    <Formulario acao={criar} textoEnviar="Criar exercício">
      <p>
        <label htmlFor="exercicio-ano">Ano</label>
        <input id="exercicio-ano" name="ano" type="number" min={2000} max={2099} defaultValue={anoPadrao} required aria-describedby="erro-ano" />
        <ErroDoCampo campo="ano" />
      </p>
      <fieldset aria-describedby="erro-forma">
        <legend>Forma de início</legend>
        <label>
          <input type="radio" name="forma" value="EM_BRANCO" defaultChecked /> Em branco
        </label>
        <label>
          <input type="radio" name="forma" value="COPIA" /> Copiando o exercício anterior (posições e pacotes, com as premissas do novo ano)
        </label>
        <ErroDoCampo campo="forma" />
      </fieldset>
      <a href="/orc/exercicios">Cancelar</a>
    </Formulario>
  );
}
