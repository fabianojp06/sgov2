import { ErroDoCampo, Formulario, type AcaoFormulario } from '@/modules/ger';
import type { CcLivreTp } from '../application/propostas';
import {
  CATEGORIAS_PROPOSTA,
  LIMITE_NUMERO_TP,
  LIMITE_OBJETO,
  LIMITE_PARCEIRO,
  ROTULO_CATEGORIA_PROPOSTA,
  ROTULO_TIPO_PROPOSTA,
  TIPOS_PROPOSTA,
} from '../domain/proposta';

// Formulário "Nova proposta" (US-065, UC 3.05; plano do P17, Task 2, D-P17-4). Sem estado próprio: o
// Formulario do ger (cliente) chama a ação e mostra os erros do Resultado ao lado de cada campo.
// Tipo, Categoria e CC começam sem escolha (opção desabilitada, que o navegador não envia): o caso de
// uso responde a E1. O Valor Global é calculado (§6.2, RN_TP_003): aparece só leitura e sem name, para
// não ir à ação (é da ORIGEM BLINDADA). O CC só entre os livres (D-P17-7).
const ESCOLHA = '';

export function FormProposta({ ccs, salvar }: { ccs: readonly CcLivreTp[]; salvar: AcaoFormulario }) {
  return (
    <section aria-labelledby="nova-proposta-titulo">
      <h2 id="nova-proposta-titulo">Nova proposta</h2>
      <Formulario acao={salvar} textoEnviar="Criar proposta">
        <p>
          <label htmlFor="nova-proposta-tipo">Tipo</label>
          <select id="nova-proposta-tipo" name="tipo" defaultValue={ESCOLHA} aria-required="true" aria-describedby="erro-tipo">
            <option value={ESCOLHA} disabled>
              Escolha o tipo
            </option>
            {TIPOS_PROPOSTA.map((t) => (
              <option key={t} value={t}>
                {ROTULO_TIPO_PROPOSTA[t]}
              </option>
            ))}
          </select>
          <ErroDoCampo campo="tipo" />
        </p>
        <p>
          <label htmlFor="nova-proposta-numero">Número do TP</label>
          <input id="nova-proposta-numero" name="numero" maxLength={LIMITE_NUMERO_TP} aria-required="true" aria-describedby="erro-numero" />
          <ErroDoCampo campo="numero" />
        </p>
        <p>
          <label htmlFor="nova-proposta-objeto">Nome/Objeto</label>
          <textarea id="nova-proposta-objeto" name="objeto" maxLength={LIMITE_OBJETO} aria-required="true" aria-describedby="erro-objeto" />
          <ErroDoCampo campo="objeto" />
        </p>
        <p>
          <label htmlFor="nova-proposta-parceiro">Parceiro/Cliente (opcional)</label>
          <input id="nova-proposta-parceiro" name="parceiro" maxLength={LIMITE_PARCEIRO} aria-describedby="erro-parceiro" />
          <ErroDoCampo campo="parceiro" />
        </p>
        <p>
          <label htmlFor="nova-proposta-inicio">Data de início</label>
          <input id="nova-proposta-inicio" name="inicio" type="date" aria-required="true" aria-describedby="erro-inicio" />
          <ErroDoCampo campo="inicio" />
        </p>
        <p>
          <label htmlFor="nova-proposta-fim">Data de término</label>
          <input id="nova-proposta-fim" name="fim" type="date" aria-required="true" aria-describedby="erro-fim" />
          <ErroDoCampo campo="fim" />
        </p>
        <p>
          <label htmlFor="nova-proposta-categoria">Categoria</label>
          <select id="nova-proposta-categoria" name="categoria" defaultValue={ESCOLHA} aria-required="true" aria-describedby="erro-categoria">
            <option value={ESCOLHA} disabled>
              Escolha a categoria
            </option>
            {CATEGORIAS_PROPOSTA.map((c) => (
              <option key={c} value={c}>
                {ROTULO_CATEGORIA_PROPOSTA[c]}
              </option>
            ))}
          </select>
          <ErroDoCampo campo="categoria" />
        </p>
        <p>
          <label htmlFor="nova-proposta-cc">Centro de custo</label>
          <select id="nova-proposta-cc" name="cc" defaultValue={ESCOLHA} aria-required="true" aria-describedby="erro-cc">
            <option value={ESCOLHA} disabled>
              Escolha o centro de custo
            </option>
            {ccs.map((c) => (
              <option key={c.classificacao} value={c.classificacao}>{`${c.classificacao} – ${c.descricao}`}</option>
            ))}
          </select>
          <ErroDoCampo campo="cc" />
        </p>
        <p>
          <label htmlFor="nova-proposta-valor">Valor global (R$)</label>
          <input id="nova-proposta-valor" value="0,00" readOnly aria-describedby="nova-proposta-valor-nota" />
          <span id="nova-proposta-valor-nota"> Calculado pelo sistema a partir dos lançamentos.</span>
        </p>
      </Formulario>
    </section>
  );
}
