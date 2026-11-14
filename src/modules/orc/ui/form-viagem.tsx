import { ErroDoCampo, Formulario, type AcaoFormulario } from '@/modules/ger';
import type { OpcaoEstrutura } from '../application/opcoes-estrutura';
import type { BlocoViagens, ViagemTela } from '../application/viagens';
import { LIMITE_LOCALIDADE, MAXIMO_PESSOAS_DIAS } from '../domain/viagem';
import { ROTULO_TIPO_PROPOSTA } from '../domain/proposta';
import { valorParaTela } from '../domain/valor-tela';

// Formulário da viagem (US-071; Viagens V3, UC03.31 e UC03.32; plano do P21, Task 2). Proposta, Tipo e Versão
// vêm da capa, só leitura. No incluir (e no copiar, D-P21-7, que é um incluir já preenchido) escolhem-se a
// meta e as contas; no alterar, a meta e as contas de passagem e de diária ficam só leitura (RN_VIA_07). O
// custo estimado não é digitado: sai da lista depois de salvar (RN_VIA_03).

export type ModoFormViagem = { modo: 'incluir' } | { modo: 'copiar'; origem: ViagemTela } | { modo: 'alterar'; viagem: ViagemTela };

const rotuloConta = (contas: readonly OpcaoEstrutura[], c: string | null) => {
  if (!c) return '';
  const o = contas.find((x) => x.classificacao === c);
  return o ? `${o.classificacao} – ${o.descricao}` : c;
};

function SeletorConta({
  id,
  nome,
  rotulo,
  contas,
  padrao,
  obrigatoria,
}: {
  id: string;
  nome: string;
  rotulo: string;
  contas: readonly OpcaoEstrutura[];
  padrao: string | null;
  obrigatoria: boolean;
}) {
  return (
    <p>
      <label htmlFor={id}>{rotulo}</label>
      <select id={id} name={nome} defaultValue={padrao ?? ''} aria-describedby={`erro-${nome}`} {...(obrigatoria ? { 'aria-required': 'true' as const } : {})}>
        <option value="">{obrigatoria ? 'Escolha a conta analítica' : 'Nenhuma'}</option>
        {contas.map((c) => (
          <option key={c.classificacao} value={c.classificacao}>
            {`${c.classificacao} – ${c.descricao}`}
          </option>
        ))}
      </select>
      <ErroDoCampo campo={nome} />
    </p>
  );
}

export function FormViagem({ bloco, modo, contas, salvar }: { bloco: BlocoViagens; modo: ModoFormViagem; contas: readonly OpcaoEstrutura[]; salvar: AcaoFormulario }) {
  const prefixo = `${modo.modo}-viagem`;
  const id = (campo: string) => `${prefixo}-${campo}`;
  const base = modo.modo === 'alterar' ? modo.viagem : modo.modo === 'copiar' ? modo.origem : null;
  const titulo =
    modo.modo === 'alterar'
      ? `Alterar a viagem para ${modo.viagem.localidade}`
      : modo.modo === 'copiar'
        ? `Nova viagem a partir da viagem para ${modo.origem.localidade}`
        : `Nova viagem na proposta ${bloco.numero}`;
  const metaAtual = modo.modo === 'alterar' ? bloco.grupos.find((g) => g.metaId === modo.viagem.metaId) : undefined;
  const valor = (v: ViagemTela['valorPassagem'] | undefined) => (v ? valorParaTela(v) : undefined);
  return (
    <section aria-labelledby={id('titulo')}>
      <h2 id={id('titulo')}>{titulo}</h2>
      <Formulario acao={salvar} textoEnviar={modo.modo === 'alterar' ? 'Salvar viagem' : 'Incluir viagem'}>
        {modo.modo === 'alterar' ? (
          <>
            <input type="hidden" name="id" value={modo.viagem.id} />
            <input type="hidden" name="versao" value={String(modo.viagem.versao)} />
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
            {modo.modo === 'alterar' ? (
              <input id={id('meta')} value={metaAtual ? `${metaAtual.metaNumero} – ${metaAtual.metaNome}` : ''} readOnly />
            ) : (
              <select id={id('meta')} name="metaId" defaultValue={base?.metaId ?? ''} aria-required="true" aria-describedby="erro-metaId">
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
          <label htmlFor={id('localidade')}>Localidade (país)</label>
          <input id={id('localidade')} name="localidade" maxLength={LIMITE_LOCALIDADE} aria-required="true" aria-describedby="erro-localidade" defaultValue={base?.localidade} />
          <ErroDoCampo campo="localidade" />
        </p>
        <p>
          <label htmlFor={id('pessoas')}>Quantidade de pessoas</label>
          <input
            id={id('pessoas')}
            name="pessoas"
            type="number"
            min={1}
            max={MAXIMO_PESSOAS_DIAS}
            step={1}
            aria-required="true"
            aria-describedby="erro-pessoas"
            defaultValue={base?.pessoas}
          />
          <ErroDoCampo campo="pessoas" />
        </p>
        <p>
          <label htmlFor={id('dias')}>Média de dias</label>
          <input id={id('dias')} name="dias" type="number" min={1} max={MAXIMO_PESSOAS_DIAS} step={1} aria-required="true" aria-describedby="erro-dias" defaultValue={base?.dias} />
          <ErroDoCampo campo="dias" />
        </p>
        <p>
          <label htmlFor={id('valorPassagem')}>Custo unitário de passagem, ida e volta (R$)</label>
          <input
            id={id('valorPassagem')}
            name="valorPassagem"
            inputMode="decimal"
            aria-required="true"
            aria-describedby="erro-valorPassagem"
            defaultValue={valor(base?.valorPassagem)}
          />
          <ErroDoCampo campo="valorPassagem" />
        </p>
        <p>
          <label htmlFor={id('valorDiaria')}>Custo de diária por pessoa (R$)</label>
          <input id={id('valorDiaria')} name="valorDiaria" inputMode="decimal" aria-required="true" aria-describedby="erro-valorDiaria" defaultValue={valor(base?.valorDiaria)} />
          <ErroDoCampo campo="valorDiaria" />
        </p>
        <p>
          <label htmlFor={id('valorTransporte')}>Custo unitário de transporte (R$), fora do custo estimado</label>
          <input id={id('valorTransporte')} name="valorTransporte" inputMode="decimal" aria-describedby="erro-valorTransporte" defaultValue={valor(base?.valorTransporte)} />
          <ErroDoCampo campo="valorTransporte" />
        </p>
        {modo.modo === 'alterar' ? (
          <>
            <p>
              <label htmlFor={id('contaPassagem')}>Conta de passagem</label>
              <input id={id('contaPassagem')} value={rotuloConta(contas, modo.viagem.contaPassagem)} readOnly />
            </p>
            <p>
              <label htmlFor={id('contaDiaria')}>Conta de diária</label>
              <input id={id('contaDiaria')} value={rotuloConta(contas, modo.viagem.contaDiaria)} readOnly />
            </p>
            {modo.viagem.contaTransporte ? (
              <p>
                <label htmlFor={id('contaTransporte')}>Conta de transporte</label>
                <input id={id('contaTransporte')} value={rotuloConta(contas, modo.viagem.contaTransporte)} readOnly />
              </p>
            ) : (
              <SeletorConta id={id('contaTransporte')} nome="contaTransporte" rotulo="Conta de transporte" contas={contas} padrao={null} obrigatoria={false} />
            )}
          </>
        ) : (
          <>
            <SeletorConta id={id('contaPassagem')} nome="contaPassagem" rotulo="Conta de passagem" contas={contas} padrao={base?.contaPassagem ?? null} obrigatoria />
            <SeletorConta id={id('contaDiaria')} nome="contaDiaria" rotulo="Conta de diária" contas={contas} padrao={base?.contaDiaria ?? null} obrigatoria />
            <SeletorConta
              id={id('contaTransporte')}
              nome="contaTransporte"
              rotulo="Conta de transporte"
              contas={contas}
              padrao={base?.contaTransporte ?? null}
              obrigatoria={false}
            />
          </>
        )}
      </Formulario>
      <p>
        <a href="/orc/viagens">Cancelar</a>
      </p>
    </section>
  );
}
