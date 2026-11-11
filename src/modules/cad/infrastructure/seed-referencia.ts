import { lerAmbiente } from '@/modules/ger/servidor';
import { auditar, type ContextoAuditoria } from '@/shared/audit';
import type { Seed, TxCliente } from '@/shared/db';
import { sanearDescricao } from '../application/saneamento';
import { planejarCarga } from '../domain/carga';
import { validarPlanoContas, type LinhaLida } from '../domain/plano-contas';
import { validarCargosRubi } from '../domain/cargo';
import { validarCentrosCusto } from '../domain/centros-custo';
import { aplicarCarga, aplicarCargaCentrosCusto, comoNova, comoNovoCentroCusto, lerCentrosCustoAtuais, lerContasAtuais } from './aplicar-carga';
import { aplicarCargaCargos, paraStaging } from './aplicar-carga-cargos';
import { tocarVersaoExercicio } from './parametro-sistema';
import cargosSinteticos from './dados/cargos-sinteticos.json';
import minuta from './dados/cc-minuta-rev23102026.json';
import oficial from './dados/plano-contas-oficial.json';

// Dados de referência (plano do P4, R15): o plano de contas oficial (e, nas Tasks 5 e 12a, a minuta
// de CC e os cargos sintéticos), carregados pelo mesmo núcleo do merge do worker (R6), com o tx do
// migrator e o contexto "Sistema". Só com CARGA_DADOS_REFERENCIA=1, e nunca em produção.

const SISTEMA: ContextoAuditoria = { usuarioId: null, usuarioRotulo: 'Sistema', sessaoUid: null, ip: null, unidadeId: null };

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
  if ((await tx.centroCusto.count({ where: { provisorio: false } })) > 0) {
    console.log('[SEED_CC_IGNORADA] o plano de centros de custo já tem carga aprovada pela DIREX; a minuta não foi aplicada');
    return;
  }
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

// Cargos sintéticos para dev e hml (R20, pendência P3: o layout do Rubi ainda não foi confirmado pela
// GRH). Entram SEM salário, e a seed roda sem a chave da cifra. Nunca sobrescrevem uma carga real.
async function carregarCargosSinteticos(tx: TxCliente): Promise<void> {
  if ((await tx.cargo.count()) > 0) return;
  const validado = validarCargosRubi(cargosSinteticos as LinhaLida[], sanearDescricao);
  if (!validado.ok) throw new Error(`Cargos sintéticos inválidos: ${validado.erros.length} erros`);
  const linhas = validado.cargos.map((c) => paraStaging(c, null));
  const [lote] = await tx.$queryRaw<{ id: string }[]>`INSERT INTO "carga_estrutura" ("tipo", "arquivo_nome", "arquivo_sha256", "linhas", "contexto_auditoria")
    VALUES ('CARGOS', 'Seed: cargos sintéticos', 'seed', ${linhas.length}, ${JSON.stringify(SISTEMA)}::jsonb) RETURNING "id"`;
  const r = await aplicarCargaCargos(tx, SISTEMA, { id: lote!.id }, linhas);
  await tx.cargaEstrutura.update({
    where: { id: lote!.id },
    data: { situacao: 'CONCLUIDA', incluidas: r.incluidas, alteradas: 0, inativadas: 0, inalteradas: 0, avisos: [], erros: [], concluidoEm: new Date() },
  });
}

// Cargos sintéticos utilizáveis pela posição (pedido da frente A na #138, E2E do P15): Fonte Ativa de
// mercado (sem cifra) e faixa. Em 2027, os dois primeiros têm um benefício com valor (seguro de vida,
// manual) e o terceiro nenhum (R4 do revisor); os outros itens padrão ficam inativos, para não gerarem
// o aviso de benefício sem valor. Só em cargo da seed ainda sem Fonte Ativa, faixa nem benefícios de
// 2027: nunca sobrescreve o que alguém editou, e a segunda execução não grava nada.
const ANO_BENEFICIOS = 2027;
const CARGOS_UTILIZAVEIS = [
  { codigo: 'SINT-001', fonteAtiva: 'MINIMO', minimo: '4500.00', maximo: '7200.00', seguroVida: '35.00' },
  { codigo: 'SINT-002', fonteAtiva: 'MINIMO', minimo: '2800.00', maximo: '4100.00', seguroVida: '35.00' },
  { codigo: 'SINT-003', fonteAtiva: 'MAXIMO', minimo: '5000.00', maximo: '8000.00', seguroVida: null },
] as const;

async function prepararCargosUtilizaveis(tx: TxCliente): Promise<void> {
  const cargos = await tx.cargo.findMany({
    where: { codigo: { in: CARGOS_UTILIZAVEIS.map((c) => c.codigo) }, carga: { arquivoNome: 'Seed: cargos sintéticos' } },
    select: { id: true, codigo: true, fonteAtiva: true, mercadoMinimo: true, mercadoMaximo: true },
  });
  for (const c of cargos) {
    const def = CARGOS_UTILIZAVEIS.find((d) => d.codigo === c.codigo)!;
    if (c.fonteAtiva !== null || c.mercadoMinimo !== null || c.mercadoMaximo !== null) continue;
    const depois = { fonteAtiva: def.fonteAtiva, mercadoMinimo: def.minimo, mercadoMaximo: def.maximo };
    await tx.cargo.update({
      where: { id: c.id },
      data: { ...depois, origemMercado: 'MANUAL', origemMercadoRotulo: 'Seed: dados sintéticos', versao: { increment: 1 } },
    });
    await auditar(tx, {
      contexto: SISTEMA,
      origem: 'SISTEMA',
      funcionalidade: 'cad.cargos',
      tipo: 'ALTERACAO',
      registroId: c.codigo,
      descricao: `Seed: Fonte Ativa e faixa de mercado do cargo sintético ${c.codigo}`,
      antes: { fonteAtiva: null, mercadoMinimo: null, mercadoMaximo: null },
      depois,
    });
  }

  // Benefícios de 2027: só com a Tabela Mestre do ano (a seed do cad roda antes) e o ano aberto.
  const ano = await tx.parametrosExercicio.findUnique({ where: { ano: ANO_BENEFICIOS }, select: { congeladoEm: true } });
  if (!ano || ano.congeladoEm) return;
  const padrao = await tx.beneficioMestre.findMany({ where: { ano: ANO_BENEFICIOS, padraoPosicao: true }, select: { codigo: true } });
  if (padrao.length === 0) return;
  const comEscolha = new Set(
    (await tx.beneficioCargo.findMany({ where: { ano: ANO_BENEFICIOS, cargoId: { in: cargos.map((c) => c.id) } }, select: { cargoId: true } })).map((b) => b.cargoId),
  );
  const linhas: { cargoId: string; codigoCargo: string; codigo: string; ativo: boolean; valorManual: string | null }[] = [];
  for (const c of cargos) {
    if (comEscolha.has(c.id)) continue;
    const def = CARGOS_UTILIZAVEIS.find((d) => d.codigo === c.codigo)!;
    for (const { codigo } of padrao) {
      const vida = codigo === 'beneficio.seguro_vida' && def.seguroVida !== null;
      linhas.push({ cargoId: c.id, codigoCargo: c.codigo, codigo, ativo: vida, valorManual: vida ? def.seguroVida : null });
    }
  }
  if (linhas.length === 0) return;
  // Escrita numa tabela do ano: versão única (R10) e Histórico, como qualquer outra.
  await tocarVersaoExercicio(tx, ANO_BENEFICIOS);
  await tx.beneficioCargo.createMany({
    data: linhas.map((l) => ({ cargoId: l.cargoId, ano: ANO_BENEFICIOS, codigo: l.codigo, ativo: l.ativo, valorManual: l.valorManual, origem: l.valorManual ? 'MANUAL' : 'MESTRE' })),
  });
  const porCargo: Record<string, { codigo: string; ativo: boolean; valorManual: string | null }[]> = {};
  for (const l of linhas) (porCargo[l.codigoCargo] ??= []).push({ codigo: l.codigo, ativo: l.ativo, valorManual: l.valorManual });
  await auditar(tx, {
    contexto: SISTEMA,
    origem: 'SISTEMA',
    funcionalidade: 'cad.cargos',
    tipo: 'INSERCAO',
    registroId: String(ANO_BENEFICIOS),
    descricao: `Seed: benefícios de ${ANO_BENEFICIOS} de ${Object.keys(porCargo).length} cargo(s) sintético(s)`,
    depois: porCargo,
  });
}

export const seedDadosReferenciaCad: Seed = {
  nome: 'cad (dados de referência)',
  async executar(tx) {
    const ambiente = lerAmbiente();
    if (process.env.CARGA_DADOS_REFERENCIA !== '1') return;
    if (ambiente === 'producao') throw new Error('CARGA_DADOS_REFERENCIA não pode ser usada em produção (R15)');
    await carregarPlanoOficial(tx);
    await carregarMinutaCentrosCusto(tx);
    await carregarCargosSinteticos(tx);
    await prepararCargosUtilizaveis(tx);
  },
};
