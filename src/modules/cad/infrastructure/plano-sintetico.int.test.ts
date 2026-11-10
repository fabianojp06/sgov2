import ExcelJS from 'exceljs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { seedAdm } from '@/modules/adm';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { solicitarCargaPlanoContas } from '../application/importar-estrutura';
import { COLUNAS_PLANO_CONTAS } from '../domain/plano-contas';
import { gerarPlanoSintetico } from './plano-sintetico';
import { seedCad } from './seed';
import { seedDadosReferenciaCad } from './seed-referencia';

// O .xlsx do plano sintético (o mesmo que o ops/carga/gerar-plano.ts grava) passa pela importação
// real do plano de contas, sobre o plano oficial da seed: leitura segura, validação e o plano da
// carga contra o banco, até o lote PENDENTE que o worker processa (plano do P7, Task 3, Step 1).
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: ReturnType<typeof criarPrisma>;
let migrator: pg.Client;
let usuarioId: string;

// "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: as permissões saem daqui.
const ctx = (...p: [string, string][]): ContextoRequisicao => ({ usuarioId, usuarioRotulo: 'gfin', sessaoUid: 's', ip: '127.0.0.1', permissoes: new Set(p.map(([f, a]) => `${f}:${a}`)) });

async function xlsx(total: number): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Plano de Contas');
  ws.addRow([...COLUNAS_PLANO_CONTAS]);
  for (const l of gerarPlanoSintetico(total)) ws.addRow(COLUNAS_PLANO_CONTAS.map((c) => l.celulas[c] ?? null));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  const m = criarPrisma(banco.urlMigrator);
  vi.stubEnv('CARGA_DADOS_REFERENCIA', '1');
  vi.stubEnv('AMBIENTE', 'dev');
  await executarSeeds(m, [seedAdm, seedCad, seedDadosReferenciaCad]);
  vi.unstubAllEnvs();
  await m.$disconnect();
  app = criarPrisma(banco.urlApp);
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  await migrator.connect();
  usuarioId = (await migrator.query(`INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash) VALUES ('GFIN', 'g@exemplo.org', 'g', 'g', 'x') RETURNING id`)).rows[0].id;
}, 180_000);

afterAll(async () => {
  await Promise.allSettled([app?.$disconnect(), migrator?.end()]);
  await banco?.parar();
});

describe('plano sintético de 5.000 linhas pela importação real (D-P7-3)', () => {
  it('a importação aceita o arquivo sobre o plano oficial e grava o lote com as 5.000 linhas', async () => {
    const r = await solicitarCargaPlanoContas(ctx(['cad.plano_contas', 'executar']), { nome: 'plano-sintetico.xlsx', conteudo: await xlsx(5000) }, { cliente: app });
    if (!r.ok) throw new Error(JSON.stringify(r.erros.slice(0, 5)));
    const { rows } = await migrator.query(`SELECT situacao, linhas FROM carga_estrutura WHERE id = $1`, [r.valor.cargaId]);
    expect(rows[0]).toEqual({ situacao: 'PENDENTE', linhas: 5000 });
  }, 60_000);
});
