'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { decidirSolicitacao } from '@/modules/apr';
import { definirAcao } from '@/shared/authz';
import { manipuladoresDosFluxos } from './manipuladores';

// Decisão na Central de Tarefas (US-078; plano do P26, D-P26-5). Fica na camada app/, que importa os módulos
// donos dos fluxos e injeta os manipuladores no apr (o apr não importa o orc).
const entrada = z.preprocess((v) => (v instanceof FormData ? Object.fromEntries(v.entries()) : v), z.record(z.string(), z.unknown()));

export const decidirSolicitacaoAcao = definirAcao({ funcionalidade: 'apr.tarefas', acao: 'executar', entrada }, async (e, ctx) => {
  const r = await decidirSolicitacao(ctx, e, manipuladoresDosFluxos());
  if (!r.ok) return r;
  return redirect(`/apr/tarefas?aviso=${r.valor.decisao === 'APROVAR' ? 'aprovada' : 'rejeitada'}&d=${encodeURIComponent(r.valor.descricao)}`);
});
