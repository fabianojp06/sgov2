import type { ContextoAuditoria } from '@/shared/audit';
import type { Seed, TxCliente } from '@/shared/db';
import { sanearDescricao } from '../application/saneamento';
import { planejarCarga } from '../domain/carga';
import { validarPlanoContas, type LinhaLida } from '../domain/plano-contas';
import { aplicarCarga, comoNova, lerContasAtuais } from './aplicar-carga';
import oficial from './dados/plano-contas-oficial.json';

// Dados de referência (plano do P4, R15): o plano de contas oficial (e, nas Tasks 5 e 12a, a minuta
// de CC e os cargos sintéticos), carregados pelo mesmo núcleo do merge do worker (R6), com o tx do
// migrator e o contexto "Sistema". Só com CARGA_DADOS_REFERENCIA=1, e nunca em produção.

const SISTEMA: ContextoAuditoria = { usuarioId: null, usuarioRotulo: 'Sistema', sessaoUid: null, ip: null, unidadeId: null };
const AMBIENTES = ['dev', 'hml', 'producao'] as const;

/**
 * R25: com NODE_ENV=production, AMBIENTE é obrigatório. Mesma regra do lerAmbiente do ger (PR #208);
 * quando ele estiver na main, esta função passa a usá-lo.
 */
export function ambienteDaSeed(env: NodeJS.ProcessEnv = process.env): (typeof AMBIENTES)[number] {
  const a = (env.AMBIENTE ?? '').trim();
  if ((AMBIENTES as readonly string[]).includes(a)) return a as (typeof AMBIENTES)[number];
  // Mensagem da R25; o código entre colchetes separa ausente de inválido no log.
  if (a !== '') throw new Error('[AMBIENTE_INVALIDO] AMBIENTE ausente ou inválido (use dev, hml ou producao)');
  if (env.NODE_ENV === 'production') throw new Error('[AMBIENTE_AUSENTE] AMBIENTE ausente ou inválido (use dev, hml ou producao)');
  return 'dev';
}

async function carregarPlanoOficial(tx: TxCliente): Promise<void> {
  const validado = validarPlanoContas(oficial as LinhaLida[], sanearDescricao);
  if (!validado.ok) throw new Error(`Plano de contas oficial inválido: ${validado.erros.length} erros`);
  // Idempotente: sem mudança, nem lote nem Histórico.
  const plano = planejarCarga(await lerContasAtuais(tx), validado.contas.map(comoNova));
  if (plano.incluir.length + plano.alterarDescricao.length + plano.reativar.length + plano.inativar.length === 0) return;
  const [lote] = await tx.$queryRaw<{ id: string }[]>`INSERT INTO "carga_estrutura" ("tipo", "arquivo_nome", "arquivo_sha256", "linhas", "contexto_auditoria")
    VALUES ('PLANO_CONTAS', 'Seed: plano de contas oficial', 'seed', ${validado.contas.length}, ${JSON.stringify(SISTEMA)}::jsonb) RETURNING "id"`;
  const r = await aplicarCarga(tx, SISTEMA, { id: lote!.id, tipo: 'PLANO_CONTAS' }, validado.contas);
  await tx.cargaEstrutura.update({
    where: { id: lote!.id },
    data: {
      situacao: 'CONCLUIDA',
      incluidas: r.incluidas,
      alteradas: r.alteradas,
      inativadas: r.inativadas,
      inalteradas: r.inalteradas,
      avisos: r.avisos as object[],
      erros: [],
      concluidoEm: new Date(),
    },
  });
}

export const seedDadosReferenciaCad: Seed = {
  nome: 'cad (dados de referência)',
  async executar(tx) {
    const ambiente = ambienteDaSeed();
    if (process.env.CARGA_DADOS_REFERENCIA !== '1') return;
    if (ambiente === 'producao') throw new Error('CARGA_DADOS_REFERENCIA não pode ser usada em produção (R15)');
    await carregarPlanoOficial(tx);
  },
};
