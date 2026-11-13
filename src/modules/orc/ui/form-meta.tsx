import { ErroDoCampo, Formulario, type AcaoFormulario } from '@/modules/ger';
import type { BlocoMetas, MetaTela } from '../application/metas';
import { LIMITE_NOME_META, LIMITE_NUMERO_META, LIMITE_OBSERVACAO_META, ROTULO_STATUS_META, STATUS_META } from '../domain/meta';
import { ROTULO_TIPO_PROPOSTA } from '../domain/proposta';
import { valorParaTela } from '../domain/valor-tela';

// Formulário da meta (US-067, UC03.15 e UC03.16; plano do P19, Task 2). Sem estado próprio: o Formulario do
// ger chama a ação e mostra os erros ao lado de cada campo. Proposta e Tipo vêm da capa e aparecem só leitura,
// sem name (ORIGEM BLINDADA, RN0140); no alterar, o Número também (UC03.16, passo 4). A versão da capa vai
// escondida em todo envio (trava do P19), e no alterar também o id e a versão da meta.
export function FormMeta({ bloco, meta, salvar }: { bloco: BlocoMetas; meta?: MetaTela | undefined; salvar: AcaoFormulario }) {
  const prefixo = meta ? 'alterar-meta' : 'nova-meta';
  const id = (campo: string) => `${prefixo}-${campo}`;
  const titulo = meta ? `Alterar a meta ${meta.numero} da proposta ${bloco.numero}` : `Nova meta na proposta ${bloco.numero}`;
  return (
    <section aria-labelledby={id('titulo')}>
      <h2 id={id('titulo')}>{titulo}</h2>
      <Formulario acao={salvar} textoEnviar={meta ? 'Salvar meta' : 'Incluir meta'}>
        {meta ? (
          <>
            <input type="hidden" name="id" value={meta.id} />
            <input type="hidden" name="versao" value={String(meta.versao)} />
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
          <input id={id('tipo')} value={ROTULO_TIPO_PROPOSTA[bloco.tipo]} readOnly />
        </p>
        <p>
          <label htmlFor={id('numero')}>Número da meta</label>
          {meta ? (
            <input id={id('numero')} value={meta.numero} readOnly />
          ) : (
            <input id={id('numero')} name="numero" maxLength={LIMITE_NUMERO_META} aria-required="true" aria-describedby="erro-numero" />
          )}
          <ErroDoCampo campo="numero" />
        </p>
        <p>
          <label htmlFor={id('nome')}>Nome da meta</label>
          <input id={id('nome')} name="nome" maxLength={LIMITE_NOME_META} aria-required="true" aria-describedby="erro-nome" defaultValue={meta?.nome} />
          <ErroDoCampo campo="nome" />
        </p>
        <p>
          <label htmlFor={id('valor')}>Valor global (R$)</label>
          <input
            id={id('valor')}
            name="valor"
            inputMode="decimal"
            aria-required="true"
            aria-describedby="erro-valor"
            defaultValue={meta ? valorParaTela(meta.valor) : undefined}
          />
          <ErroDoCampo campo="valor" />
        </p>
        <p>
          <label htmlFor={id('status')}>Status</label>
          <select id={id('status')} name="status" defaultValue={meta?.status ?? 'ATIVO'} aria-required="true" aria-describedby="erro-status">
            {STATUS_META.map((s) => (
              <option key={s} value={s}>
                {ROTULO_STATUS_META[s]}
              </option>
            ))}
          </select>
          <ErroDoCampo campo="status" />
        </p>
        <p>
          <label htmlFor={id('observacao')}>Observação (opcional)</label>
          <textarea id={id('observacao')} name="observacao" maxLength={LIMITE_OBSERVACAO_META} aria-describedby="erro-observacao" defaultValue={meta?.observacao ?? undefined} />
          <ErroDoCampo campo="observacao" />
        </p>
      </Formulario>
      <p>
        <a href="/orc/metas">Cancelar</a>
      </p>
    </section>
  );
}
