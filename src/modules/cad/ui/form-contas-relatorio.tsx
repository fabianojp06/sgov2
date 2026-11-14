'use client';

import { useState, useTransition } from 'react';
import type { ErroCampo } from '@/shared/kernel';
import type { PapelTela, SinteticaTela } from '../application/contas-relatorio';
import { MSG_SO_CONSULTA } from './form-parametros';

// Contas dos relatórios (US-097): um formulário por relatório, com as sintéticas ativas para marcar. O valor que a
// tela mostrava vai junto, para a gravação concorrente ser recusada. A marcada que uma recarga inativou continua
// na lista, sinalizada, para poder ser desmarcada.

type Resposta = { ok: true; valor: { valor: string } } | { ok: false; erros: readonly ErroCampo[] };
type Alterar = (e: { papel: string; classificacoes: string[]; anterior: string }) => Promise<Resposta>;

export function FormContasRelatorio({
  papel: p,
  sinteticas,
  podeAlterar,
  alterar,
}: {
  papel: PapelTela;
  sinteticas: readonly SinteticaTela[];
  podeAlterar: boolean;
  alterar: Alterar;
}) {
  const [marcadas, setMarcadas] = useState<readonly string[]>(p.marcadas);
  const [anterior, setAnterior] = useState(p.valor);
  const [erros, setErros] = useState<readonly ErroCampo[]>([]);
  const [salvo, setSalvo] = useState(false);
  const [salvando, iniciar] = useTransition();
  const ativas = new Set(sinteticas.map((s) => s.classificacao));
  const opcoes = [...sinteticas, ...p.marcadas.filter((c) => !ativas.has(c)).map((c) => ({ classificacao: c, descricao: '(inativa ou fora do plano)' }))];
  const id = `contas-${p.papel}`;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => {
          setSalvo(false);
          try {
            const r = await alterar({ papel: p.papel, classificacoes: [...marcadas], anterior });
            if (r.ok) {
              setAnterior(r.valor.valor);
              setErros([]);
              setSalvo(true);
            } else {
              setErros(r.erros);
            }
          } catch {
            setErros([{ campo: '_', mensagem: 'Não foi possível salvar. Confira a conexão e tente de novo.' }]);
          }
        });
      }}
      aria-busy={salvando}
      noValidate
    >
      {erros.length > 0 && (
        <ul role="alert">
          {erros.map((e, i) => (
            <li key={i}>{e.mensagem}</li>
          ))}
        </ul>
      )}
      <p role="status">{salvo ? `Contas de ${p.rotulo} salvas.` : ''}</p>
      <fieldset disabled={!podeAlterar} aria-describedby={`${id}-ajuda`}>
        <legend>{p.rotulo}</legend>
        <p id={`${id}-ajuda`}>
          {p.ajuda} {marcadas.length === 0 ? 'Nenhuma marcada: o relatório sai vazio.' : `${marcadas.length} marcada(s).`}
        </p>
        <div style={{ maxHeight: '16em', overflowY: 'auto' }}>
          {opcoes.map((s) => (
            <div key={s.classificacao}>
              <label>
                <input
                  type="checkbox"
                  checked={marcadas.includes(s.classificacao)}
                  onChange={(e) => setMarcadas((m) => (e.target.checked ? [...m, s.classificacao] : m.filter((c) => c !== s.classificacao)))}
                />{' '}
                {s.classificacao} – {s.descricao}
              </label>
            </div>
          ))}
        </div>
      </fieldset>
      {podeAlterar ? (
        <button type="submit" disabled={salvando}>
          Salvar {p.rotulo}
        </button>
      ) : (
        <p>{MSG_SO_CONSULTA}</p>
      )}
    </form>
  );
}
