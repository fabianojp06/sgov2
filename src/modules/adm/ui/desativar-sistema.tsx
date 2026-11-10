'use client';

import { unstable_rethrow } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import type { ErroCampo, Resultado } from '@/shared/kernel';
import { MENSAGENS_SISTEMA, MOTIVO_MAXIMO, normalizarMotivo } from '../domain/sistema';

// Desativar o sistema (UC02.01 FA1, passos 2.2 a 2.6): botão, confirmação Sim/Não (FA3) e o modal do
// motivo, obrigatório, com OK e Cancelar (RN0073, FA4). O modal é do adm: a AcaoConfirmada do ger
// roda a ação logo depois do Sim e não tem o passo do motivo. Com o motivo vazio, o E1 aparece e o
// modal continua aberto; o servidor confere de novo. A ação recebe o motivo num FormData e, no
// sucesso, redireciona (o sinal de navegação segue para o Next).
type AcaoDesativar = (dados: FormData) => Promise<Resultado<unknown>>;

const MENSAGEM_FALHA = 'Não foi possível concluir a operação. Tente novamente.';

export function DesativarSistema({ acao, habilitado }: { acao: AcaoDesativar; habilitado: boolean }) {
  const [etapa, setEtapa] = useState<'fechado' | 'confirmando' | 'motivo'>('fechado');
  const [motivo, setMotivo] = useState('');
  const [erros, setErros] = useState<readonly ErroCampo[]>([]);
  const [pendente, iniciarTransicao] = useTransition();
  const idPergunta = useId();
  const idTitulo = useId();
  const idErro = useId();
  const origem = useRef<HTMLButtonElement>(null);
  const nao = useRef<HTMLButtonElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const abriu = useRef(false);

  // Foco: no Não ao confirmar (a opção segura), no campo ao abrir o modal e de volta ao botão ao fechar.
  useEffect(() => {
    if (etapa === 'confirmando') nao.current?.focus();
    if (etapa === 'motivo') campo.current?.focus();
    if (etapa !== 'fechado') abriu.current = true;
    else if (abriu.current) {
      abriu.current = false;
      origem.current?.focus();
    }
  }, [etapa]);

  const fechar = () => {
    if (pendente) return;
    setEtapa('fechado');
    setMotivo('');
    setErros([]);
  };

  const confirmarMotivo = () => {
    const v = normalizarMotivo(motivo);
    if (!v.ok) {
      setErros([{ campo: 'motivo', mensagem: v.mensagem }]);
      campo.current?.focus();
      return;
    }
    iniciarTransicao(async () => {
      try {
        const dados = new FormData();
        dados.set('motivo', v.motivo);
        const r = await acao(dados);
        if (!r.ok) setErros(r.erros);
      } catch (erro) {
        unstable_rethrow(erro);
        setErros([{ campo: '_', mensagem: MENSAGEM_FALHA }]);
      }
    });
  };

  return (
    <>
      <button type="button" ref={origem} disabled={!habilitado || pendente} onClick={() => setEtapa('confirmando')}>
        Desativar
      </button>
      {etapa === 'confirmando' && (
        <div role="alertdialog" aria-labelledby={idPergunta} onKeyDown={(e) => e.key === 'Escape' && fechar()}>
          <p id={idPergunta}>{MENSAGENS_SISTEMA.CONFIRMAR_DESATIVAR}</p>
          <button type="button" onClick={() => setEtapa('motivo')}>
            Sim
          </button>
          <button type="button" ref={nao} onClick={fechar}>
            Não
          </button>
        </div>
      )}
      {etapa === 'motivo' && (
        <div role="dialog" aria-modal="true" aria-labelledby={idTitulo} onKeyDown={(e) => e.key === 'Escape' && fechar()}>
          <h2 id={idTitulo}>Desativação do sistema</h2>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              confirmarMotivo();
            }}
          >
            <label htmlFor={`${idTitulo}-motivo`}>Motivo da desativação</label>
            <textarea
              id={`${idTitulo}-motivo`}
              ref={campo}
              name="motivo"
              required
              maxLength={MOTIVO_MAXIMO}
              value={motivo}
              aria-invalid={erros.length > 0}
              aria-describedby={idErro}
              onChange={(e) => setMotivo(e.target.value)}
            />
            <div id={idErro} role="alert">
              {erros.map((e, i) => (
                <p key={i}>{e.mensagem}</p>
              ))}
            </div>
            <button type="submit" disabled={pendente}>
              OK
            </button>
            <button type="button" disabled={pendente} onClick={fechar}>
              Cancelar
            </button>
          </form>
        </div>
      )}
    </>
  );
}
