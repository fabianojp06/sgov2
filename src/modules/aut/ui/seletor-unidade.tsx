'use client';

import { useState, useTransition } from 'react';
import type { ErroCampo } from '@/shared/kernel';

type Unidade = { id: string; codigo: string; nome: string };
type RespostaAcaoTela = { ok: true } | { ok: false; status?: number; erros: readonly ErroCampo[] };

// Seletor de TP (§6.7): lista só os TPs do usuário; com um só, mostra o nome dele sem seletor. A
// troca recarrega a tela com o filtro da unidade no servidor (a ação chama revalidatePath). A recusa
// aparece ao usuário; sessão expirada (401) volta ao login.
export function SeletorUnidade({
  unidades,
  unidadeAtiva,
  trocar,
}: {
  unidades: readonly Unidade[];
  unidadeAtiva: string | null;
  trocar: (d: { unidadeId: string }) => Promise<RespostaAcaoTela>;
}) {
  const [trocando, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  if (unidades.length === 0) return null;
  if (unidades.length === 1) return <span className="sgo-unidade">{unidades[0]!.nome}</span>;
  return (
    <>
      <label className="sgo-unidade">
        Termo de Parceria
        <select
          value={unidadeAtiva ?? ''}
          disabled={trocando}
          onChange={(e) => {
            const unidadeId = e.target.value;
            setErro(null);
            iniciar(async () => {
              const r = await trocar({ unidadeId });
              if (r.ok) return;
              if (r.status === 401) window.location.replace('/login');
              else setErro(r.erros[0]?.mensagem ?? 'Não foi possível trocar o TP.');
            });
          }}
        >
          <option value="" disabled>
            Selecione o TP
          </option>
          {unidades.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nome}
            </option>
          ))}
        </select>
      </label>
      {erro ? <span role="alert">{erro}</span> : null}
    </>
  );
}
