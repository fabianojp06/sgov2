import { ErroDoCampo, Formulario, type AcaoFormulario } from '@/modules/ger';
import type { BemTela, BlocoBens, OpcoesBem } from '../application/bens';
import { LIMITE_DESCRICAO_BEM, QUANTIDADE_MAXIMA_BEM } from '../domain/bem';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { ROTULO_TIPO_PROPOSTA } from '../domain/proposta';
import { valorParaTela } from '../domain/valor-tela';

// Formulário do bem, serviço ou equipamento (US-072; UC03.35 e UC03.36; plano do P22, Task 2). Proposta, Tipo e
// Versão vêm da capa, só leitura. A meta (só na categoria Meta, RN0170) e a conta podem ser escolhidas também
// no alterar (D-P22-4). O valor total não é digitado (RF_PAT_REQ_009): sai da lista depois de salvar.
export function FormBem({ bloco, bem, opcoes, salvar }: { bloco: BlocoBens; bem?: BemTela | undefined; opcoes: OpcoesBem; salvar: AcaoFormulario }) {
  const prefixo = bem ? 'alterar-bem' : 'novo-bem';
  const id = (campo: string) => `${prefixo}-${campo}`;
  return (
    <section aria-labelledby={id('titulo')}>
      <h2 id={id('titulo')}>{bem ? `Alterar o item "${bem.descricao}"` : `Novo bem, serviço ou equipamento na proposta ${bloco.numero}`}</h2>
      <Formulario acao={salvar} textoEnviar={bem ? 'Salvar item' : 'Incluir item'}>
        {bem ? (
          <>
            <input type="hidden" name="id" value={bem.id} />
            <input type="hidden" name="versao" value={String(bem.versao)} />
          </>
        ) : (
          <input type="hidden" name="propostaId" value={bloco.propostaId} />
        )}
        <input type="hidden" name="versaoCapa" value={String(bloco.versaoCapa)} />
        <p>
          <label htmlFor={id('proposta')}>Proposta</label>
          <input id={id('proposta')} value={`${bloco.numero} – ${bloco.objeto}`} readOnly />
        </p>
        <p>
          <label htmlFor={id('tipo')}>Tipo</label>
          <input id={id('tipo')} value={`${ROTULO_TIPO_PROPOSTA[bloco.tipo]} · Versão ${bloco.versaoNumero}`} readOnly />
        </p>
        {bloco.categoria === 'META' && (
          <p>
            <label htmlFor={id('meta')}>Meta</label>
            <select id={id('meta')} name="metaId" defaultValue={bem?.metaId ?? ''} aria-required="true" aria-describedby="erro-metaId">
              <option value="" disabled>
                Escolha a meta
              </option>
              {bloco.metas.map((m) => (
                <option key={m.id} value={m.id}>
                  {`${m.numero} – ${m.nome}`}
                </option>
              ))}
            </select>
            <ErroDoCampo campo="metaId" />
          </p>
        )}
        <p>
          <label htmlFor={id('conta')}>Conta analítica</label>
          <select id={id('conta')} name="conta" defaultValue={bem?.conta ?? ''} aria-required="true" aria-describedby="erro-conta">
            <option value="" disabled>
              Escolha a conta analítica
            </option>
            {opcoes.contas.map((c) => (
              <option key={c.classificacao} value={c.classificacao}>
                {`${c.classificacao} – ${c.descricao}`}
              </option>
            ))}
          </select>
          <ErroDoCampo campo="conta" />
          {opcoes.semCapex && <small role="note">{` ${MENSAGENS_ORC.BEM_SEM_CONTAS_CAPEX}`}</small>}
        </p>
        <p>
          <label htmlFor={id('descricao')}>Descrição</label>
          <input id={id('descricao')} name="descricao" maxLength={LIMITE_DESCRICAO_BEM} aria-required="true" aria-describedby="erro-descricao" defaultValue={bem?.descricao} />
          <ErroDoCampo campo="descricao" />
        </p>
        <p>
          <label htmlFor={id('data')}>Data</label>
          <input id={id('data')} name="data" type="date" aria-required="true" aria-describedby="erro-data" defaultValue={bem?.data} />
          <ErroDoCampo campo="data" />
        </p>
        <p>
          <label htmlFor={id('quantidade')}>Quantidade</label>
          <input
            id={id('quantidade')}
            name="quantidade"
            type="number"
            min={1}
            max={QUANTIDADE_MAXIMA_BEM}
            step={1}
            aria-required="true"
            aria-describedby="erro-quantidade"
            defaultValue={bem?.quantidade}
          />
          <ErroDoCampo campo="quantidade" />
        </p>
        <p>
          <label htmlFor={id('valorUnitario')}>Valor unitário (R$)</label>
          <input
            id={id('valorUnitario')}
            name="valorUnitario"
            inputMode="decimal"
            aria-required="true"
            aria-describedby="erro-valorUnitario"
            defaultValue={bem ? valorParaTela(bem.valorUnitario) : undefined}
          />
          <ErroDoCampo campo="valorUnitario" />
        </p>
      </Formulario>
      <p>
        <a href="/orc/bens">Cancelar</a>
      </p>
    </section>
  );
}
