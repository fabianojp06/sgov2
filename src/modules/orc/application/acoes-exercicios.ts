'use server';

import { redirect } from 'next/navigation';
import { definirAcao } from '@/shared/authz';
import { entradaBruta, entradaVersionada } from './entrada-exercicio';
import { avancarExercicio, criarExercicio } from './exercicios';

// Ações da tela de exercícios (US-055). Depois do sucesso, voltam à lista com o aviso.
export const criar = definirAcao({ funcionalidade: 'orc.exercicios', acao: 'incluir', entrada: entradaBruta }, async (e, ctx) => {
  const r = await criarExercicio(ctx, e);
  if (!r.ok) return r;
  const puladas = r.valor.puladas.posicoes + r.valor.puladas.pacotes;
  redirect(e['forma'] === 'COPIA' ? `/orc/exercicios?aviso=copiado&puladas=${puladas}` : '/orc/exercicios?aviso=criado');
});

export const avancar = definirAcao({ funcionalidade: 'orc.exercicios', acao: 'alterar', entrada: entradaVersionada }, async (e, ctx) => {
  const r = await avancarExercicio(ctx, e.id, e.versao);
  if (!r.ok) return r;
  redirect('/orc/exercicios?aviso=avancado');
});
