'use server';

import { redirect } from 'next/navigation';
import { definirAcao } from '@/shared/authz';
import { alterarEmpregado, excluirEmpregado, incluirEmpregado } from './empregados';
import { entradaBruta } from './entrada-exercicio';
import { finalizarLotePessoal } from './lote-pessoal';
import { alterarQtde, excluirQtde, incluirQtde } from './qtde-empregados';

// Ações das telas de pessoal da proposta (US-070; plano do P20, Task 2). Depois do sucesso, voltam à lista com
// o aviso: a ordem e o nome do empregado, ou o documento do quantitativo (o texto sai das mensagens do orc).
const voltarEmpregado = (aviso: 'incluido' | 'alterado' | 'excluido', r: { ordem: number; nome: string }): never =>
  redirect(`/orc/empregados?aviso=${aviso}&o=${r.ordem}&n=${encodeURIComponent(r.nome)}`);
const voltarQtde = (aviso: 'incluida' | 'alterada' | 'excluida', documento: string): never =>
  redirect(`/orc/qtde-empregados?aviso=${aviso}&d=${encodeURIComponent(documento)}`);

export const incluirEmpregadoAcao = definirAcao({ funcionalidade: 'orc.empregados', acao: 'incluir', entrada: entradaBruta }, async (e, ctx) => {
  const r = await incluirEmpregado(ctx, e);
  if (!r.ok) return r;
  return voltarEmpregado('incluido', r.valor);
});

export const alterarEmpregadoAcao = definirAcao({ funcionalidade: 'orc.empregados', acao: 'alterar', entrada: entradaBruta }, async (e, ctx) => {
  const r = await alterarEmpregado(ctx, e);
  if (!r.ok) return r;
  return voltarEmpregado('alterado', r.valor);
});

export const excluirEmpregadoAcao = definirAcao({ funcionalidade: 'orc.empregados', acao: 'excluir', entrada: entradaBruta }, async (e, ctx) => {
  const r = await excluirEmpregado(ctx, e);
  if (!r.ok) return r;
  return voltarEmpregado('excluido', r.valor);
});

export const incluirQtdeAcao = definirAcao({ funcionalidade: 'orc.qtde_empregados', acao: 'incluir', entrada: entradaBruta }, async (e, ctx) => {
  const r = await incluirQtde(ctx, e);
  if (!r.ok) return r;
  return voltarQtde('incluida', r.valor.documento);
});

export const alterarQtdeAcao = definirAcao({ funcionalidade: 'orc.qtde_empregados', acao: 'alterar', entrada: entradaBruta }, async (e, ctx) => {
  const r = await alterarQtde(ctx, e);
  if (!r.ok) return r;
  return voltarQtde('alterada', r.valor.documento);
});

export const excluirQtdeAcao = definirAcao({ funcionalidade: 'orc.qtde_empregados', acao: 'excluir', entrada: entradaBruta }, async (e, ctx) => {
  const r = await excluirQtde(ctx, e);
  if (!r.ok) return r;
  return voltarQtde('excluida', r.valor.documento);
});

// Finalizar os lançamentos de pessoal e enviar para homologação (US-080, WA05; plano do P27).
export const finalizarLotePessoalAcao = definirAcao({ funcionalidade: 'orc.empregados', acao: 'executar', entrada: entradaBruta }, async (e, ctx) => {
  const r = await finalizarLotePessoal(ctx, e);
  if (!r.ok) return r;
  return redirect(`/orc/empregados?aviso=finalizado&n=${encodeURIComponent(r.valor.numero)}`);
});
