import { z } from 'zod';
import type { QuemPedeIA, ServicoIA } from '@/shared/ia';
import type { SugestaoContaCc } from '../domain/sugestao-ia';
import { semMarcas } from '../domain/texto';
import { CASOS_IA_ORC } from './ia-casos';
import type { OpcaoEstrutura } from './opcoes-estrutura';

// A consulta da sugestão de conta e CC (US-062; plano do P14, D-P14-2): a mensagem, o schema da resposta
// e a conferência contra as listas. Usada pelo caso de uso da tela (ia-sugestao-conta.ts) e pela
// avaliação no worker (D-P14-9), para as duas medirem a mesma coisa. Sem autorização de tela nem
// dependências de página (o worker/bundle.test.ts reprova).

const CASO = CASOS_IA_ORC.sugestaoConta;
export const MAXIMO_CONTAS_SUGERIDAS = 3;

// trim no schema: motivo só de espaços fica fora do formato.
const motivo = z.string().trim().min(1).max(500);
// Resposta da IA: fora do schema, o provedor devolve ErroIA('ia.saida_invalida').
export const RESPOSTA_SUGESTAO_CONTA = z.object({
  contas: z
    .array(z.object({ conta: z.string().trim().max(40), motivo }))
    .min(1)
    .max(MAXIMO_CONTAS_SUGERIDAS),
  cc: z.object({ cc: z.string().trim().max(40), motivo }).nullable(),
});

/** As listas que a IA pode usar: as mesmas do formulário do pacote. */
export type ListasSugestao = { contas: readonly OpcaoEstrutura[]; ccs: readonly OpcaoEstrutura[] };

const linha = (o: OpcaoEstrutura) => `${o.classificacao} – ${semMarcas(o.descricao)}`;

export function montarMensagemSugestaoConta(descricao: string, listas: ListasSugestao): string {
  return [
    'Descrição do gasto digitada:',
    '<<<',
    semMarcas(descricao),
    '>>>',
    '',
    'Contas permitidas (classificação – descrição):',
    ...listas.contas.map(linha),
    '',
    'Centros de custo permitidos (classificação – descrição):',
    ...(listas.ccs.length > 0 ? listas.ccs.map(linha) : ['nenhum: responda sem centro de custo']),
  ].join('\n');
}

/**
 * Consulta a IA e confere a resposta contra as listas: contas fora da lista ou repetidas saem (a ordem
 * da IA fica), e um CC fora da lista vira null. Pode voltar sem nenhuma conta. Lança o ErroIA.
 */
export async function consultarSugestaoConta(ia: ServicoIA, quem: QuemPedeIA, descricao: string, listas: ListasSugestao, sinal?: AbortSignal): Promise<SugestaoContaCc> {
  const { valor } = await ia.gerarEstruturado(quem, CASO, montarMensagemSugestaoConta(descricao, listas), RESPOSTA_SUGESTAO_CONTA, sinal);
  const contas = new Map(listas.contas.map((c) => [c.classificacao, c.descricao]));
  const ccs = new Map(listas.ccs.map((c) => [c.classificacao, c.descricao]));
  const vistas = new Set<string>();
  const validas: { conta: string; descricao: string; motivo: string }[] = [];
  for (const s of valor.contas) {
    const conta = s.conta;
    const desc = contas.get(conta);
    if (desc === undefined || vistas.has(conta)) continue;
    vistas.add(conta);
    validas.push({ conta, descricao: desc, motivo: s.motivo });
  }
  const cc = valor.cc?.cc ?? '';
  const descCc = ccs.get(cc);
  return { contas: validas, cc: valor.cc && descCc !== undefined ? { cc, descricao: descCc, motivo: valor.cc.motivo } : null };
}
