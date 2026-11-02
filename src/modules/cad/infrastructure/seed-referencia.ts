import type { ContextoAuditoria } from '@/shared/audit';
import type { Seed, TxCliente } from '@/shared/db';
import { sanearDescricao } from '../application/saneamento';
import { planejarCarga } from '../domain/carga';
import { validarPlanoContas, type LinhaLida } from '../domain/plano-contas';
import { validarCentrosCusto } from '../domain/centros-custo';
import { aplicarCarga, aplicarCargaCentrosCusto, comoNova, comoNovoCentroCusto, lerCentrosCustoAtuais, lerContasAtuais } from './aplicar-carga';
import minuta from './dados/cc-minuta-rev23102026.json';
import { ambienteDoCad } from './ambiente';
import oficial from './dados/plano-contas-oficial.json';

// Dados de referência (plano do P4, R15): o plano de contas oficial (e, nas Tasks 5 e 12a, a minuta
// de CC e os cargos sintéticos), carregados pelo mesmo núcleo do merge do worker (R6), com o tx do
// migrator e o contexto "Sistema". Só com CARGA_DADOS_REFERENCIA=1, e nunca em produção.

const SISTEMA: ContextoAuditoria = { usuarioId: null, usuarioRotulo: 'Sistema', sessaoUid: null, ip: null, unidadeId: null };
// A regra de AMBIENTE (R25) é a do ambiente.ts, compartilhada com o processador de cargas.
export { ambienteDoCad as ambienteDaSeed } from './ambiente';

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

// A minuta de CC entra provisória: ainda não tem a aprovação da DIREX (GAP-CC-001).
async function carregarMinutaCentrosCusto(tx: TxCliente): Promise<void> {
  const validado = validarCentrosCusto(minuta as LinhaLida[], sanearDescricao);
  if (!validado.ok) throw new Error(`Minuta de centros de custo inválida: ${validado.erros.length} erros`);
  // Uma minuta nunca sobrescreve um plano de CC já aprovado pela DIREX.
  if ((await tx.centroCusto.count({ where: { provisorio: false } })) > 0) return;
  // Idempotente: sem mudança, nem lote nem Histórico.
  const plano = planejarCarga(await lerCentrosCustoAtuais(tx), validado.centros.map(comoNovoCentroCusto));
  if (plano.incluir.length + plano.alterarDescricao.length + plano.reativar.length + plano.inativar.length === 0) return;
  const [lote] = await tx.$queryRaw<{ id: string }[]>`INSERT INTO "carga_estrutura" ("tipo", "arquivo_nome", "arquivo_sha256", "linhas", "provisoria", "contexto_auditoria")
    VALUES ('CENTROS_CUSTO', 'Seed: minuta de centros de custo Rev23102026', 'seed', ${validado.centros.length}, true, ${JSON.stringify(SISTEMA)}::jsonb) RETURNING "id"`;
  const r = await aplicarCargaCentrosCusto(tx, SISTEMA, { id: lote!.id, provisoria: true }, validado.centros);
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
    const ambiente = ambienteDoCad();
    if (process.env.CARGA_DADOS_REFERENCIA !== '1') return;
    if (ambiente === 'producao') throw new Error('CARGA_DADOS_REFERENCIA não pode ser usada em produção (R15)');
    await carregarPlanoOficial(tx);
    await carregarMinutaCentrosCusto(tx);
  },
};
