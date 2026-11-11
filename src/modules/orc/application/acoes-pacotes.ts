'use server';

import { redirect } from 'next/navigation';
import { definirAcao } from '@/shared/authz';
import { entradaBruta } from './entrada-exercicio';
import { alterarPacote, excluirPacote, incluirPacote, type ResultadoPacote } from './pacotes';

// Ações da tela de pacotes base zero (US-057). Depois do sucesso, voltam à lista do CC com o aviso.
// O id gravado vai em "salvo": a tela usa na key do formulário de inclusão, que recomeça do zero a
// cada gravação (sem a sugestão da IA nem a marca sugestaoIa do pacote anterior; D-P14-3).
const voltar = (r: ResultadoPacote, aviso: string): never =>
  redirect(`/orc/pacotes?ano=${r.ano}&cc=${encodeURIComponent(r.cc)}&aviso=${aviso}&salvo=${encodeURIComponent(r.id)}`);

export const incluirPacoteAcao = definirAcao({ funcionalidade: 'orc.pacotes', acao: 'incluir', entrada: entradaBruta }, async (e, ctx) => {
  const r = await incluirPacote(ctx, e);
  if (!r.ok) return r;
  return voltar(r.valor, 'incluido');
});

export const alterarPacoteAcao = definirAcao({ funcionalidade: 'orc.pacotes', acao: 'alterar', entrada: entradaBruta }, async (e, ctx) => {
  const r = await alterarPacote(ctx, e);
  if (!r.ok) return r;
  return voltar(r.valor, 'alterado');
});

export const excluirPacoteAcao = definirAcao({ funcionalidade: 'orc.pacotes', acao: 'excluir', entrada: entradaBruta }, async (e, ctx) => {
  const r = await excluirPacote(ctx, e);
  if (!r.ok) return r;
  return voltar(r.valor, 'excluido');
});
