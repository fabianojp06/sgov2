import { ErroDoCampo, Formulario, type AcaoFormulario } from '@/modules/ger';
import type { OpcaoEstrutura } from '../application/opcoes-estrutura';
import type { BlocoViagens, TetoTela } from '../application/viagens';
import { valorParaTela } from '../domain/valor-tela';

// Formulário do teto de viagens (US-071, Camada 1; C6 e decisão do PO de 13/11; plano do P21, D-P21-5). No
// incluir, a conta sintética e o valor; no alterar, só o valor (a conta fica só leitura).
export function FormTetoViagem({
  bloco,
  teto,
  sinteticas,
  salvar,
}: {
  bloco: BlocoViagens;
  teto?: TetoTela | undefined;
  sinteticas: readonly OpcaoEstrutura[];
  salvar: AcaoFormulario;
}) {
  const prefixo = teto ? 'alterar-teto' : 'novo-teto';
  const id = (campo: string) => `${prefixo}-${campo}`;
  return (
    <section aria-labelledby={id('titulo')}>
      <h2 id={id('titulo')}>{teto ? `Alterar o teto da conta ${teto.contaSintetica}` : `Novo teto de viagens na proposta ${bloco.numero}`}</h2>
      <Formulario acao={salvar} textoEnviar={teto ? 'Salvar teto' : 'Incluir teto'}>
        {teto ? (
          <>
            <input type="hidden" name="id" value={teto.id} />
            <input type="hidden" name="versao" value={String(teto.versao)} />
          </>
        ) : (
          <input type="hidden" name="propostaId" value={bloco.propostaId} />
        )}
        <input type="hidden" name="versaoCapa" value={String(bloco.versaoCapa)} />
        <p>
          <label htmlFor={id('conta')}>Conta sintética</label>
          {teto ? (
            <input id={id('conta')} value={`${teto.contaSintetica} – ${teto.descricao}`} readOnly />
          ) : (
            <select id={id('conta')} name="contaSintetica" defaultValue="" aria-required="true" aria-describedby="erro-contaSintetica">
              <option value="" disabled>
                Escolha a conta sintética
              </option>
              {sinteticas.map((c) => (
                <option key={c.classificacao} value={c.classificacao}>
                  {`${c.classificacao} – ${c.descricao}`}
                </option>
              ))}
            </select>
          )}
          <ErroDoCampo campo="contaSintetica" />
        </p>
        <p>
          <label htmlFor={id('valor')}>Teto da conta (R$)</label>
          <input id={id('valor')} name="valor" inputMode="decimal" aria-required="true" aria-describedby="erro-valor" defaultValue={teto ? valorParaTela(teto.valor) : undefined} />
          <ErroDoCampo campo="valor" />
        </p>
      </Formulario>
      <p>
        <a href="/orc/viagens">Cancelar</a>
      </p>
    </section>
  );
}
