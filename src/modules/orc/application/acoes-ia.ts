'use server';

import { definirAcao } from '@/shared/authz';
import { entradaBruta } from './entrada-exercicio';
import { sugerirJustificativa } from './ia-justificativa';
import { explicarDesvio } from './ia-desvio';
import { destacarRiscos } from './ia-previsao';
import { sugerirRecusa } from './ia-recusa';
import { sugerirContaCc } from './ia-sugestao-conta';

// Ações da ajuda da IA no orc (plano do P14, D-P14-4): Server Action sem stream, com tempo limite de
// 30 s no caso de uso. A guarda confere a permissão do caso; o caso de uso exige também incluir ou
// alterar pacote; a justificativa confere o escopo do CC antes de chamar a IA, e a sugestão de conta
// só oferece as contas e os CCs do formulário (opcoesPacote). Só leitura: nada é gravado.
export const sugerirJustificativaAcao = definirAcao({ funcionalidade: 'orc.ia_justificativa', acao: 'executar', entrada: entradaBruta }, (e, ctx) => sugerirJustificativa(ctx, e));
export const sugerirContaCcAcao = definirAcao({ funcionalidade: 'orc.ia_sugestao_conta', acao: 'executar', entrada: entradaBruta }, (e, ctx) => sugerirContaCc(ctx, e));
// A ajuda na recusa da oficialização (US-084, D-P30-6): a guarda confere o caso; o caso de uso, a tarefa do aprovador.
export const sugerirRecusaAcao = definirAcao({ funcionalidade: 'orc.ia_recusa', acao: 'executar', entrada: entradaBruta }, (e, ctx) => sugerirRecusa(ctx, e));
// O destaque das contas em risco na previsão de fechamento (US-091, D-P34-3): a guarda confere o caso; o caso de uso,
// a permissão do Orçado x Realizado e a RLS (pela previsão).
export const destacarRiscosAcao = definirAcao({ funcionalidade: 'orc.ia_previsao', acao: 'executar', entrada: entradaBruta }, (e, ctx) => destacarRiscos(ctx, e));
// A explicação do desvio no Orçado x Realizado (US-090, D-P35-1): a guarda confere o caso; o caso de uso, a permissão
// do Orçado x Realizado e a RLS (pela tela).
export const explicarDesvioAcao = definirAcao({ funcionalidade: 'orc.ia_desvio', acao: 'executar', entrada: entradaBruta }, (e, ctx) => explicarDesvio(ctx, e));
