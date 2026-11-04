import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// O Histórico é só inserção (US-006): a trava está nos gatilhos e nos REVOKE da migration que cria a
// tabela. Nenhuma migration depois dela pode desligar, apagar ou trocar essa trava (#172).
const PASTA = join(process.cwd(), 'prisma', 'migrations');
const CRIACAO = '202610260100_nucleo_historico';

const SEM_COMENTARIOS = (sql: string) => sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const VEDADOS: readonly [string, RegExp][] = [
  ['DISABLE TRIGGER', /\bDISABLE\s+TRIGGER\b/i],
  ['session_replication_role', /\bsession_replication_role\b/i],
  ['DROP TRIGGER', /\bDROP\s+TRIGGER\b/i],
  ['DROP TABLE do Histórico', /\bDROP\s+TABLE\b[^;]*historico_operacao/i],
  ['DROP FUNCTION da trava', /\bDROP\s+FUNCTION\b[^;]*historico_somente_insercao/i],
  ['troca da função da trava', /\bCREATE\s+OR\s+REPLACE\s+FUNCTION\b[^;(]*historico_somente_insercao/i],
  ['ALTER TABLE do Histórico', /\bALTER\s+TABLE\b[^;]*historico_operacao[^;]*\b(RENAME|DISABLE|NO\s+FORCE|OWNER)\b/i],
  ['GRANT de alteração no Histórico', /\bGRANT\b[^;]*\b(UPDATE|DELETE|TRUNCATE)\b[^;]*\bON\b[^;]*historico_operacao/i],
];

function violacoesHistorico(sql: string): string[] {
  const limpo = SEM_COMENTARIOS(sql);
  return VEDADOS.filter(([, re]) => re.test(limpo)).map(([nome]) => nome);
}

describe('migrations não mexem na trava do Histórico', () => {
  it('o detector acha cada forma vedada e ignora comentário', () => {
    expect(violacoesHistorico('ALTER TABLE "historico_operacao" DISABLE TRIGGER ALL;')).toEqual(['DISABLE TRIGGER', 'ALTER TABLE do Histórico']);
    expect(violacoesHistorico('SET session_replication_role = replica;')).toEqual(['session_replication_role']);
    expect(violacoesHistorico('DROP TRIGGER historico_operacao_sem_alteracao ON "historico_operacao";')).toEqual(['DROP TRIGGER']);
    expect(violacoesHistorico('DROP TABLE IF EXISTS "historico_operacao";')).toEqual(['DROP TABLE do Histórico']);
    expect(violacoesHistorico('DROP FUNCTION historico_somente_insercao();')).toEqual(['DROP FUNCTION da trava']);
    expect(violacoesHistorico('CREATE OR REPLACE FUNCTION historico_somente_insercao() RETURNS trigger AS $$ BEGIN RETURN NEW; END $$;')).toEqual(['troca da função da trava']);
    expect(violacoesHistorico('GRANT SELECT, UPDATE ON "historico_operacao" TO sgo_app;')).toEqual(['GRANT de alteração no Histórico']);
    expect(violacoesHistorico('-- DROP TRIGGER x\nCREATE INDEX i ON "historico_operacao"("ocorrido_em");')).toEqual([]);
    expect(violacoesHistorico('DROP TABLE "orc_rascunho"; GRANT UPDATE ON "orc_linha" TO sgo_app;')).toEqual([]);
  });

  it('nenhuma migration depois da criação do Histórico tem forma vedada', () => {
    const migrations = readdirSync(PASTA, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== CRIACAO)
      .map((d) => d.name);
    expect(migrations.length).toBeGreaterThan(0);
    const achados = migrations.flatMap((m) => violacoesHistorico(readFileSync(join(PASTA, m, 'migration.sql'), 'utf8')).map((v) => `${m}: ${v}`));
    expect(achados).toEqual([]);
  });
});
