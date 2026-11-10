'use client';

import { useState, type FormEvent } from 'react';
import { ErroDoCampo, Formulario } from '@/modules/ger';
import type { AcaoFormulario } from '@/modules/ger';
import { previaPacote, type CamposPrevia } from '../domain/previa-pacote';
import { valorParaTela } from '../domain/valor-tela';

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
}) {
  const [campos, setCampos] = useState<CamposPrevia>(() => camposIniciais(pacote));
  // A prévia acompanha o que está digitado: lê o formulário inteiro a cada mudança.
  const aoMudar = (e: FormEvent<HTMLDivElement>) => {
    const form = e.currentTarget.closest('form');
    if (!form) return;
    const d = new FormData(form);
    const t = (k: string) => (typeof d.get(k) === 'string' ? (d.get(k) as string) : '');
    setCampos({ quantidade: t('quantidade'), valorUnitario: t('valorUnitario'), corrigirIpca: t('corrigirIpca'), distribuicao: t('distribuicao'), mesOcorrencia: t('mesOcorrencia') });
  };
  const previa = previaPacote(campos, ipca, quantidadeMaxima);
  const pontual = campos.distribuicao === 'Pontual';
  const prefixo = pacote ? 'alterar-pacote' : 'novo-pacote';
  return (
    <section aria-labelledby={`${prefixo}-titulo`}>
      <h2 id={`${prefixo}-titulo`}>{pacote ? 'Alterar pacote' : 'Novo pacote'}</h2>
      {avisoOrigem && <p role="note">{avisoOrigem}</p>}
      <Formulario acao={salvar} textoEnviar={pacote ? 'Salvar alteração' : 'Incluir pacote'}>
        {pacote ? (
          <>
            <input type="hidden" name="id" value={pacote.id} />
            <input type="hidden" name="versao" value={pacote.versao} />
          </>
        ) : (
          <input type="hidden" name="exercicioId" value={exercicioId} />
        )}
        <div onChange={aoMudar}>
          <p>
            <label htmlFor={`${prefixo}-cc`}>Centro de custo</label>
            <select id={`${prefixo}-cc`} name="cc" defaultValue={pacote?.cc ?? ccAtual} aria-describedby="erro-cc">
              {ccs.map((c) => (
                <option key={c.classificacao} value={c.classificacao}>{`${c.classificacao} – ${c.descricao}`}</option>
              ))}
            </select>
            <ErroDoCampo campo="cc" />
          </p>
          <p>
            <label htmlFor={`${prefixo}-conta`}>Conta</label>
            <select id={`${prefixo}-conta`} name="conta" defaultValue={pacote?.conta ?? ''} aria-describedby="erro-conta">
              <option value="">Escolha a conta</option>
              {contas.map((c) => (
                <option key={c.classificacao} value={c.classificacao}>{`${c.classificacao} – ${c.descricao}`}</option>
              ))}
            </select>
            <ErroDoCampo campo="conta" />
          </p>
          <p>
            <label htmlFor={`${prefixo}-justificativa`}>Atividade / justificativa (mín. 10 caracteres)</label>
            <textarea id={`${prefixo}-justificativa`} name="justificativa" maxLength={1000} defaultValue={pacote?.justificativa ?? ''} aria-describedby="erro-justificativa" />
            <ErroDoCampo campo="justificativa" />
          </p>
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
        <section aria-labelledby={`${prefixo}-previa`} aria-live="polite">
          <h3 id={`${prefixo}-previa`}>{`Prévia (${ano})`}</h3>
          {!previa.ok ? (
            <p>{previa.motivo}</p>
          ) : (
            <>
              <p>
                {`Valor anual: R$ ${valorParaTela(previa.valorAnual)}`}
                {previa.ipcaAplicado && ` (corrigido pelo IPCA do exercício, ${previa.ipcaAplicado.formatar()})`}
              </p>
              {previa.mesOcorrencia !== null ? (
                <p>{`Todo o valor em ${MESES[previa.mesOcorrencia - 1]}.`}</p>
              ) : (
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
