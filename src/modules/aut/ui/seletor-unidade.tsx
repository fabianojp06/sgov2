'use client';

import { useTransition } from 'react';
import type { ErroCampo } from '@/shared/kernel';

type Unidade = { id: string; codigo: string; nome: string };
type RespostaAcaoTela = { ok: true } | { ok: false; erros: readonly ErroCampo[] };

// Seletor de TP (§6.7): lista só os TPs do usuário e some quando há um só. A troca recarrega a
// tela com o filtro da unidade no servidor (a ação chama revalidatePath).
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
  if (unidades.length <= 1) return null;
  return (
    <label className="sgo-unidade">
      Termo de Parceria
      <select
        value={unidadeAtiva ?? ''}
        disabled={trocando}
        onChange={(e) => {
          const unidadeId = e.target.value;
          iniciar(async () => {
            await trocar({ unidadeId });
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
  );
}
