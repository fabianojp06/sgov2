import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// O Histórico é só inserção (US-006): a trava está nos gatilhos e nos REVOKE da migration que cria a
// tabela. Nenhuma migration depois dela pode desligar, apagar ou trocar essa trava (#172).
const PASTA = join(process.cwd(), 'prisma', 'migrations');
const CRIACAO = '202610260100_nucleo_historico';

const SEM_COMENTARIOS = (sql: string) => sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const HIST = String.raw`(?:"historico_operacao"|historico_operacao\b)`;
const TRAVA = String.raw`(?:"historico_somente_insercao"|historico_somente_insercao\b)`;
// Cada comando (até o `;`) é conferido sozinho. Gatilhos: nenhuma migration desliga, troca ou apaga
// gatilho de tabela nenhuma (o Histórico é a única tabela com gatilho e a regra fica simples).
const VEDADOS: readonly [string, RegExp][] = [
  ['gatilho desligado', /\b(DISABLE|ENABLE\s+(REPLICA|ALWAYS))\s+TRIGGER\b/i],
  ['session_replication_role', /\bsession_replication_role\b/i],
  ['DROP TRIGGER', /\bDROP\s+TRIGGER\b/i],
  ['troca de gatilho', /\bCREATE\s+OR\s+REPLACE\s+TRIGGER\b/i],
  ['DROP TABLE do Histórico', new RegExp(String.raw`\bDROP\s+TABLE\b.*${HIST}`, 'is')],
  ['DROP FUNCTION da trava', new RegExp(String.raw`\bDROP\s+FUNCTION\b.*${TRAVA}`, 'is')],
  ['troca da função da trava', new RegExp(String.raw`\b(CREATE\s+OR\s+REPLACE|ALTER)\s+FUNCTION\b.*${TRAVA}`, 'is')],
  // Só ADD COLUMN é aceito no Histórico: renomear, mudar tipo, apagar coluna, trocar dono ou schema não.
  ['ALTER TABLE do Histórico', new RegExp(String.raw`^\s*ALTER\s+TABLE\b(\s+ONLY)?(\s+IF\s+EXISTS)?\s+(public\.)?${HIST}(?!\s+ADD\s+COLUMN\b)`, 'is')],
  ['GRANT de alteração no Histórico', new RegExp(String.raw`\bGRANT\b.*\b(UPDATE|DELETE|TRUNCATE|ALL)\b.*\bON\b.*${HIST}`, 'is')],
  ['GRANT em todas as tabelas', /\bGRANT\b.*\b(UPDATE|DELETE|TRUNCATE|ALL)\b.*\bON\s+ALL\s+TABLES\b/is],
];

function violacoesHistorico(sql: string): string[] {
  const comandos = SEM_COMENTARIOS(sql).split(';');
  return VEDADOS.filter(([, re]) => comandos.some((c) => re.test(c))).map(([nome]) => nome);
}

describe('migrations não mexem na trava do Histórico', () => {
  it('o detector acha cada forma vedada e ignora comentário', () => {
    expect(violacoesHistorico('ALTER TABLE "historico_operacao" DISABLE TRIGGER ALL;')).toEqual(['gatilho desligado', 'ALTER TABLE do Histórico']);
    expect(violacoesHistorico('SET session_replication_role = replica;')).toEqual(['session_replication_role']);
    expect(violacoesHistorico('DROP TRIGGER historico_operacao_sem_alteracao ON "historico_operacao";')).toEqual(['DROP TRIGGER']);
    expect(violacoesHistorico('DROP TABLE IF EXISTS "historico_operacao";')).toEqual(['DROP TABLE do Histórico']);
    expect(violacoesHistorico('DROP FUNCTION historico_somente_insercao();')).toEqual(['DROP FUNCTION da trava']);
    expect(violacoesHistorico('CREATE OR REPLACE FUNCTION historico_somente_insercao() RETURNS trigger AS $$ BEGIN RETURN NEW; END $$;')).toEqual(['troca da função da trava']);
    expect(violacoesHistorico('GRANT SELECT, UPDATE ON "historico_operacao" TO sgo_app;')).toEqual(['GRANT de alteração no Histórico']);
    expect(violacoesHistorico('-- DROP TRIGGER x\nCREATE INDEX i ON "historico_operacao"("ocorrido_em");')).toEqual([]);
    expect(violacoesHistorico('DROP TABLE "orc_rascunho"; GRANT UPDATE ON "orc_linha" TO sgo_app;')).toEqual([]);
    expect(violacoesHistorico('ALTER TABLE "historico_operacao" ENABLE REPLICA TRIGGER historico_operacao_sem_alteracao;')).toContain('gatilho desligado');
    expect(violacoesHistorico('CREATE OR REPLACE TRIGGER t BEFORE UPDATE ON "historico_operacao" FOR EACH ROW EXECUTE FUNCTION f();')).toEqual(['troca de gatilho']);
    expect(violacoesHistorico('GRANT ALL ON "historico_operacao" TO sgo_app;')).toEqual(['GRANT de alteração no Histórico']);
    expect(violacoesHistorico('GRANT UPDATE ON ALL TABLES IN SCHEMA public TO sgo_app;')).toEqual(['GRANT em todas as tabelas']);
    expect(violacoesHistorico('ALTER TABLE "historico_operacao" ALTER COLUMN "depois" TYPE text USING "depois"::text;')).toEqual(['ALTER TABLE do Histórico']);
    expect(violacoesHistorico('ALTER TABLE "historico_operacao" DROP COLUMN "ip";')).toEqual(['ALTER TABLE do Histórico']);
    expect(violacoesHistorico('ALTER TABLE "historico_operacao" SET SCHEMA arquivo;')).toEqual(['ALTER TABLE do Histórico']);
    expect(violacoesHistorico('ALTER FUNCTION historico_somente_insercao() OWNER TO x;')).toEqual(['troca da função da trava']);
    // Aceitos: coluna nova no Histórico e tabela de nome parecido.
    expect(violacoesHistorico('ALTER TABLE "historico_operacao" ADD COLUMN "origem_ia" text;')).toEqual([]);
    expect(violacoesHistorico('DROP TABLE "historico_operacao_arquivo"; ALTER TABLE "historico_operacao_arquivo" DROP COLUMN x;')).toEqual([]);
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
