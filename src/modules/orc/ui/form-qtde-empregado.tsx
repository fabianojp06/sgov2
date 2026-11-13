import { ErroDoCampo, Formulario, type AcaoFormulario } from '@/modules/ger';
import type { BlocoQtdes, QtdeTela } from '../application/qtde-empregados';
import { LIMITE_DOCUMENTO_QTDE } from '../domain/empregado';
import { ROTULO_TIPO_PROPOSTA } from '../domain/proposta';

// Formulário do quantitativo por período (US-070, UC03.21 e UC03.22; plano do P20, Task 2). Só o período e o
// número do documento são digitados (REQ0133); Proposta, Tipo e Versão vêm da capa, só leitura, e no alterar a
// Meta também (RN0151). As quantidades são contadas na lista, nunca digitadas (RN0457).
export function FormQtdeEmpregado({ bloco, qtde, salvar }: { bloco: BlocoQtdes; qtde?: QtdeTela | undefined; salvar: AcaoFormulario }) {
  const prefixo = qtde ? 'alterar-qtde' : 'nova-qtde';
  const id = (campo: string) => `${prefixo}-${campo}`;
  const titulo = qtde ? `Alterar o quantitativo do documento ${qtde.documento}` : `Novo quantitativo na proposta ${bloco.numero}`;
  const metaAtual = qtde ? bloco.grupos.find((g) => g.metaId === qtde.metaId) : undefined;
  return (
    <section aria-labelledby={id('titulo')}>
      <h2 id={id('titulo')}>{titulo}</h2>
      <Formulario acao={salvar} textoEnviar={qtde ? 'Salvar quantitativo' : 'Incluir quantitativo'}>
        {qtde ? (
          <>
            <input type="hidden" name="id" value={qtde.id} />
            <input type="hidden" name="versao" value={String(qtde.versao)} />
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
            {qtde ? (
              <input id={id('meta')} value={metaAtual ? `${metaAtual.metaNumero} – ${metaAtual.metaNome}` : ''} readOnly />
            ) : (
              <select id={id('meta')} name="metaId" defaultValue="" aria-required="true" aria-describedby="erro-metaId">
                <option value="" disabled>
                  Escolha a meta
                </option>
                {bloco.metas.map((m) => (
                  <option key={m.id} value={m.id}>
                    {`${m.numero} – ${m.nome}`}
                  </option>
                ))}
              </select>
            )}
            <ErroDoCampo campo="metaId" />
          </p>
        )}
        <p>
          <label htmlFor={id('inicio')}>Período inicial (mês e ano)</label>
          <input
            id={id('inicio')}
            name="inicio"
            type="month"
            min={bloco.vigencia.inicio}
            max={bloco.vigencia.fim}
            aria-required="true"
            aria-describedby="erro-inicio"
            defaultValue={qtde?.inicio ?? bloco.vigencia.inicio}
          />
          <ErroDoCampo campo="inicio" />
        </p>
        <p>
          <label htmlFor={id('fim')}>Período final (mês e ano)</label>
          <input
            id={id('fim')}
            name="fim"
            type="month"
            min={bloco.vigencia.inicio}
            max={bloco.vigencia.fim}
            aria-required="true"
            aria-describedby="erro-fim"
            defaultValue={qtde?.fim ?? bloco.vigencia.fim}
          />
          <ErroDoCampo campo="fim" />
        </p>
        <p>
          <label htmlFor={id('documento')}>Número do documento</label>
          <input id={id('documento')} name="documento" maxLength={LIMITE_DOCUMENTO_QTDE} aria-required="true" aria-describedby="erro-documento" defaultValue={qtde?.documento} />
          <ErroDoCampo campo="documento" />
        </p>
      </Formulario>
      <p>
        <a href="/orc/qtde-empregados">Cancelar</a>
      </p>
    </section>
  );
}
