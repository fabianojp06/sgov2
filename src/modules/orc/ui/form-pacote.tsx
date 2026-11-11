'use client';

import { useRef, useState } from 'react';
import { ErroDoCampo, Formulario } from '@/modules/ger';
import type { AcaoFormulario } from '@/modules/ger';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { previaPacote, type CamposPrevia } from '../domain/previa-pacote';
import { deveMarcarSugestao, ROTULO_FALTANDO, ROTULO_PRIORIDADE, type SugestaoContaCc, type SugestaoJustificativa, type SugestoesAceitas } from '../domain/sugestao-ia';
import { valorParaTela } from '../domain/valor-tela';
import { PainelIA, type RespostaIaTela } from './painel-ia';

// Formulário do pacote base zero (US-057; plano do P11, Task 2), com a prévia do anual e das 12
// parcelas calculada aqui pela mesma função pura do servidor (D-P11-6). Componente cliente: ações,
// opções, IPCA e limite da quantidade chegam por props da página (nada do cad nem do servidor).
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'] as const;
const PRIORIDADES = [
  ['ESSENCIAL', 'Essencial'],
  ['IMPORTANTE', 'Importante'],
  ['DESEJAVEL', 'Desejável'],
] as const;

export type OpcaoPacote = { classificacao: string; descricao: string };
// Ajuda da IA na justificativa (US-063): a Server Action do orc, por props.
export type AcaoSugerirJustificativa = (entrada: Record<string, string>) => Promise<RespostaIaTela<SugestaoJustificativa>>;
// Sugestão de conta e CC pela descrição do gasto (US-062): a Server Action do orc, por props.
export type AcaoSugerirContaCc = (entrada: Record<string, string>) => Promise<RespostaIaTela<SugestaoContaCc>>;

export type PacoteEmEdicao = {
  id: string;
  cc: string;
  conta: string;
  justificativa: string;
  prioridade: string;
  quantidade: string;
  valorUnitario: string;
  corrigirIpca: boolean;
  distribuicao: 'MENSAL' | 'PONTUAL';
  mesOcorrencia: string;
  versao: number;
};

const camposIniciais = (p?: PacoteEmEdicao): CamposPrevia => ({
  quantidade: p?.quantidade ?? '',
  valorUnitario: p?.valorUnitario ?? '',
  corrigirIpca: p ? (p.corrigirIpca ? 'Sim' : 'Não') : 'Não',
  distribuicao: p ? (p.distribuicao === 'PONTUAL' ? 'Pontual' : 'Mensal') : 'Mensal',
  mesOcorrencia: p?.mesOcorrencia ?? '',
});

export function FormPacote({
  ano,
  exercicioId,
  ccAtual,
  ccs,
  contas,
  ipca,
  quantidadeMaxima,
  pacote,
  avisoOrigem,
  salvar,
  cancelarPara,
  sugerirJustificativa,
  sugerirContaCc,
}: {
  ano: number;
  exercicioId: string;
  ccAtual: string;
  ccs: readonly OpcaoPacote[];
  contas: readonly OpcaoPacote[];
  ipca: string | null;
  quantidadeMaxima: number;
  pacote?: PacoteEmEdicao;
  avisoOrigem?: string | undefined;
  salvar: AcaoFormulario;
  cancelarPara: string;
  sugerirJustificativa?: AcaoSugerirJustificativa | undefined;
  sugerirContaCc?: AcaoSugerirContaCc | undefined;
}) {
  // CC fora das opções: o seletor começa vazio, para o pacote não mudar de CC sem o usuário escolher.
  const ccInicial = ccs.some((c) => c.classificacao === (pacote?.cc ?? ccAtual)) ? (pacote?.cc ?? ccAtual) : '';
  const [campos, setCampos] = useState<CamposPrevia>(() => camposIniciais(pacote));
  const campoRef = useRef<HTMLDivElement>(null);
  const justificativaRef = useRef<HTMLTextAreaElement>(null);
  const ccRef = useRef<HTMLSelectElement>(null);
  const contaRef = useRef<HTMLSelectElement>(null);
  const aceitas = useRef<SugestoesAceitas>({});
  const [marcada, setMarcada] = useState(false);
  const lerFormulario = () => {
    const form = campoRef.current?.closest('form');
    const d = form ? new FormData(form) : new FormData();
    return (k: string) => (typeof d.get(k) === 'string' ? (d.get(k) as string) : '');
  };
  // A marca sugestaoIa vai junto enquanto algum campo continua com o valor aceito (D-P14-3).
  const conferirMarca = (t: (k: string) => string) =>
    setMarcada(deveMarcarSugestao(aceitas.current, { justificativa: t('justificativa'), prioridade: t('prioridade'), conta: t('conta'), cc: t('cc') }));
  // A prévia acompanha o que está digitado: lê o formulário inteiro a cada mudança.
  const aoMudar = () => {
    const t = lerFormulario();
    setCampos({ quantidade: t('quantidade'), valorUnitario: t('valorUnitario'), corrigirIpca: t('corrigirIpca'), distribuicao: t('distribuicao'), mesOcorrencia: t('mesOcorrencia') });
    conferirMarca(t);
  };
  const pedirJustificativa = () => {
    const t = lerFormulario();
    const campo = (k: string) => [k, t(k)] as const;
    return sugerirJustificativa!({
      exercicioId,
      ...Object.fromEntries(['cc', 'conta', 'justificativa', 'prioridade', 'quantidade', 'valorUnitario', 'distribuicao'].map(campo)),
    });
  };
  // "Usar …" só preenche o campo, que continua editável (D-P14-3).
  const usarTexto = (texto: string) => {
    const area = justificativaRef.current;
    if (!area) return;
    area.value = texto;
    aceitas.current = { ...aceitas.current, justificativa: texto };
    conferirMarca(lerFormulario());
    area.focus();
  };
  const usarPrioridade = (rotulo: string) => {
    const radio = campoRef.current?.querySelector<HTMLInputElement>(`input[name="prioridade"][value="${rotulo}"]`);
    if (!radio) return;
    // A sugerida já era a marcada: nada veio da IA, e a entrada não leva a marca.
    if (!radio.checked) {
      radio.checked = true;
      aceitas.current = { ...aceitas.current, prioridade: rotulo };
    }
    conferirMarca(lerFormulario());
    radio.focus();
  };
  // A descrição do gasto é o texto da justificativa (D-P14-2).
  const pedirContaCc = () => sugerirContaCc!({ exercicioId, descricao: lerFormulario()('justificativa') });
  // "Usar esta conta" e "Usar este CC" trocam o seletor, que continua editável (D-P14-3). As opções da
  // IA já vieram conferidas contra as mesmas listas dos seletores; a lista de contas não depende do CC.
  const usarNoSeletor = (seletor: HTMLSelectElement | null, campo: 'conta' | 'cc', valor: string) => {
    if (!seletor || ![...seletor.options].some((o) => o.value === valor)) return;
    // A sugerida já era a escolhida: nada veio da IA, e a entrada não leva a marca.
    if (seletor.value !== valor) {
      seletor.value = valor;
      aceitas.current = { ...aceitas.current, [campo]: valor };
    }
    conferirMarca(lerFormulario());
    seletor.focus();
  };
  const previa = previaPacote(campos, ipca, quantidadeMaxima);
  const pontual = campos.distribuicao === 'Pontual';
  const prefixo = pacote ? 'alterar-pacote' : 'novo-pacote';
  return (
    <section aria-labelledby={`${prefixo}-titulo`}>
      <h2 id={`${prefixo}-titulo`}>{pacote ? 'Alterar pacote' : 'Novo pacote'}</h2>
      {avisoOrigem && <p role="note">{avisoOrigem}</p>}
      {/* Conta ou CC gravados que saíram das opções (vetados ou inativos): é preciso escolher outro. */}
      {pacote && !ccs.some((c) => c.classificacao === pacote.cc) && <p role="note">{MENSAGENS_ORC.CC_PACOTE_FORA_DAS_OPCOES(pacote.cc)}</p>}
      {pacote && !contas.some((c) => c.classificacao === pacote.conta) && <p role="note">{MENSAGENS_ORC.CONTA_PACOTE_FORA_DAS_OPCOES(pacote.conta)}</p>}
      <Formulario acao={salvar} textoEnviar={pacote ? 'Salvar alteração' : 'Incluir pacote'}>
        {pacote ? (
          <>
            <input type="hidden" name="id" value={pacote.id} />
            <input type="hidden" name="versao" value={pacote.versao} />
          </>
        ) : (
          <input type="hidden" name="exercicioId" value={exercicioId} />
        )}
        {marcada && <input type="hidden" name="sugestaoIa" value="true" />}
        <div onChange={aoMudar} ref={campoRef}>
          <p>
            <label htmlFor={`${prefixo}-cc`}>Centro de custo</label>
            <select id={`${prefixo}-cc`} ref={ccRef} name="cc" defaultValue={ccInicial} aria-describedby="erro-cc">
              {ccInicial === '' && <option value="" disabled>Escolha o centro de custo</option>}
              {ccs.map((c) => (
                <option key={c.classificacao} value={c.classificacao}>{`${c.classificacao} – ${c.descricao}`}</option>
              ))}
            </select>
            <ErroDoCampo campo="cc" />
          </p>
          <p>
            <label htmlFor={`${prefixo}-conta`}>Conta</label>
            <select id={`${prefixo}-conta`} ref={contaRef} name="conta" defaultValue={pacote?.conta ?? ''} aria-describedby="erro-conta">
              <option value="">Escolha a conta</option>
              {contas.map((c) => (
                <option key={c.classificacao} value={c.classificacao}>{`${c.classificacao} – ${c.descricao}`}</option>
              ))}
            </select>
            <ErroDoCampo campo="conta" />
          </p>
          {sugerirContaCc && (
            <PainelIA<SugestaoContaCc>
              id={`${prefixo}-ia-conta`}
              titulo="Sugestão de conta e CC pela IA"
              rotuloBotao="Sugerir conta e CC"
              aviso={MENSAGENS_ORC.IA_SUGESTAO_CONTA_AVISO}
              pedir={pedirContaCc}
            >
              {(s) => (
                <>
                  <p>Contas sugeridas, da mais provável para a menos provável:</p>
                  <ol>
                    {s.contas.map((c) => (
                      <li key={c.conta}>
                        <strong>{`${c.conta} – ${c.descricao}`}</strong>. {c.motivo}{' '}
                        <button type="button" aria-label={`Usar esta conta: ${c.conta}`} onClick={() => usarNoSeletor(contaRef.current, 'conta', c.conta)}>
                          Usar esta conta
                        </button>
                      </li>
                    ))}
                  </ol>
                  {s.cc ? (
                    <p>
                      Centro de custo sugerido: <strong>{`${s.cc.cc} – ${s.cc.descricao}`}</strong>. {s.cc.motivo}{' '}
                      <button type="button" onClick={() => usarNoSeletor(ccRef.current, 'cc', s.cc!.cc)}>
                        Usar este CC
                      </button>
                    </p>
                  ) : (
                    <p>A IA não sugeriu centro de custo.</p>
                  )}
                </>
              )}
            </PainelIA>
          )}
          <p>
            <label htmlFor={`${prefixo}-justificativa`}>Atividade / justificativa (mín. 10 caracteres)</label>
            <textarea
              id={`${prefixo}-justificativa`}
              ref={justificativaRef}
              name="justificativa"
              maxLength={1000}
              defaultValue={pacote?.justificativa ?? ''}
              aria-describedby="erro-justificativa"
            />
            <ErroDoCampo campo="justificativa" />
          </p>
          {sugerirJustificativa && (
            <PainelIA<SugestaoJustificativa>
              id={`${prefixo}-ia-justificativa`}
              titulo="Ajuda da IA na justificativa"
              rotuloBotao="Pedir ajuda da IA na justificativa"
              aviso={MENSAGENS_ORC.IA_SEM_NOMES}
              pedir={pedirJustificativa}
            >
              {(s) => (
                <>
                  <p>Texto sugerido:</p>
                  <blockquote>{s.texto}</blockquote>
                  <button type="button" onClick={() => usarTexto(s.texto)}>
                    Usar este texto
                  </button>
                  {s.faltando.length === 0 ? (
                    <p>A justificativa já traz a quantidade, o motivo e a alternativa.</p>
                  ) : (
                    <>
                      <p>O que falta na justificativa:</p>
                      <ul>
                        {s.faltando.map((f) => (
                          <li key={f}>{ROTULO_FALTANDO[f]}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  <p>{`Prioridade sugerida: ${ROTULO_PRIORIDADE[s.prioridade]}. ${s.motivoPrioridade}`}</p>
                  <button type="button" onClick={() => usarPrioridade(ROTULO_PRIORIDADE[s.prioridade])}>
                    Usar esta prioridade
                  </button>
                </>
              )}
            </PainelIA>
          )}
          <fieldset aria-describedby="erro-prioridade">
            <legend>Prioridade</legend>
            {PRIORIDADES.map(([codigo, rotulo]) => (
              <label key={codigo}>
                <input type="radio" name="prioridade" value={rotulo} defaultChecked={pacote ? pacote.prioridade === codigo : codigo === 'IMPORTANTE'} /> {rotulo}
              </label>
            ))}
            <ErroDoCampo campo="prioridade" />
          </fieldset>
          <p>
            <label htmlFor={`${prefixo}-quantidade`}>Quantidade</label>
            <input id={`${prefixo}-quantidade`} name="quantidade" inputMode="numeric" defaultValue={pacote?.quantidade ?? ''} aria-describedby="erro-quantidade" />
            <ErroDoCampo campo="quantidade" />
          </p>
          <p>
            <label htmlFor={`${prefixo}-valor`}>Valor unitário (R$)</label>
            <input id={`${prefixo}-valor`} name="valorUnitario" inputMode="decimal" placeholder="0,00" defaultValue={pacote?.valorUnitario ?? ''} aria-describedby="erro-valorUnitario" />
            <ErroDoCampo campo="valorUnitario" />
          </p>
          <fieldset aria-describedby="erro-corrigirIpca">
            <legend>Corrigir pelo IPCA?</legend>
            <label>
              <input type="radio" name="corrigirIpca" value="Sim" defaultChecked={campos.corrigirIpca === 'Sim'} /> Sim
            </label>
            <label>
              <input type="radio" name="corrigirIpca" value="Não" defaultChecked={campos.corrigirIpca !== 'Sim'} /> Não
            </label>
            <ErroDoCampo campo="corrigirIpca" />
          </fieldset>
          <fieldset aria-describedby="erro-distribuicao">
            <legend>Distribuição</legend>
            <label>
              <input type="radio" name="distribuicao" value="Mensal" defaultChecked={!pontual} /> Mensal (12 parcelas)
            </label>
            <label>
              <input type="radio" name="distribuicao" value="Pontual" defaultChecked={pontual} /> Pontual (um mês)
            </label>
            <ErroDoCampo campo="distribuicao" />
          </fieldset>
          <p>
            <label htmlFor={`${prefixo}-mes`}>Mês (se pontual)</label>
            <select id={`${prefixo}-mes`} name="mesOcorrencia" defaultValue={pacote?.mesOcorrencia ?? ''} disabled={!pontual} aria-describedby="erro-mesOcorrencia">
              <option value="">Escolha o mês</option>
              {MESES.map((m, i) => (
                <option key={m} value={String(i + 1)}>
                  {m}
                </option>
              ))}
            </select>
            <ErroDoCampo campo="mesOcorrencia" />
          </p>
        </div>
        <section aria-labelledby={`${prefixo}-previa`}>
          <h3 id={`${prefixo}-previa`}>{`Prévia (${ano})`}</h3>
          {/* Só o resumo é anunciado ao digitar; a tabela das 12 parcelas não (seria verborrágico). */}
          <p aria-live="polite">
            {!previa.ok
              ? previa.motivo
              : `Valor anual: R$ ${valorParaTela(previa.valorAnual)}${previa.ipcaAplicado ? ` (corrigido pelo IPCA do exercício, ${previa.ipcaAplicado.formatar()})` : ''}.${
                  previa.mesOcorrencia !== null ? ` Todo o valor em ${MESES[previa.mesOcorrencia - 1]}.` : ''
                }`}
          </p>
          {previa.ok && (
            <>
              {previa.mesOcorrencia === null && (
                <table>
                  <caption>Parcelas mensais em R$ (centavos que sobram vão para dezembro)</caption>
                  <thead>
                    <tr>
                      {MESES.map((m) => (
                        <th key={m} scope="col">
                          <abbr title={m}>{m.slice(0, 3)}</abbr>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {previa.meses.map((v, i) => (
                        <td key={i}>{valorParaTela(v)}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              )}
              <p>O valor gravado é recalculado pelo sistema ao salvar.</p>
            </>
          )}
        </section>
        <a href={cancelarPara}>Cancelar</a>
      </Formulario>
    </section>
  );
}
