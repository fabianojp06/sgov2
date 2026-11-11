'use server';

import { definirAcao } from '@/shared/authz';
import { entradaBruta } from './entrada-exercicio';
import { sugerirJustificativa } from './ia-justificativa';

// Ações da ajuda da IA no orc (plano do P14, D-P14-4): Server Action sem stream, com tempo limite de
// 30 s no caso de uso. A guarda confere a permissão do caso; o caso de uso exige também incluir ou
// alterar pacote e confere o escopo do CC antes de chamar a IA. Só leitura: nada é gravado.
export const sugerirJustificativaAcao = definirAcao({ funcionalidade: 'orc.ia_justificativa', acao: 'executar', entrada: entradaBruta }, (e, ctx) => sugerirJustificativa(ctx, e));
