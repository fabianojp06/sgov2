import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// O Histórico é só inserção (US-006): a trava está nos gatilhos e nos REVOKE da migration que cria a
// tabela. Nenhuma migration depois dela pode desligar, apagar ou trocar essa trava (#172).
const PASTA = join(process.cwd(), 'prisma', 'migrations');
const CRIACAO = '202610260100_nucleo_historico';

// Texto entre aspas simples sai antes dos comentários: um '--' dentro dele não esconde o resto.
const LIMPAR = (sql: string) =>
  sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
const ESQUEMA = String.raw`(?:"?public"?\.)?`;
const HIST = String.raw`${ESQUEMA}(?:"historico_operacao"|historico_operacao\b)`;
const TRAVA = String.raw`${ESQUEMA}(?:"historico_somente_insercao"|historico_somente_insercao\b)`;

// ALTER TABLE no Histórico só com ADD COLUMN, em todas as ações do comando: renomear, mudar tipo,
// apagar coluna, trocar dono ou schema, não. Parênteses saem antes de separar as ações pela vírgula.
const ALTER_HIST = new RegExp(String.raw`\bALTER\s+TABLE\s+(?:(?:ONLY|IF\s+EXISTS)\s+)*${HIST}([\s\S]*)$`, 'i');
function alterTableVedado(comando: string): boolean {
  const m = ALTER_HIST.exec(comando);
  if (!m) return false;
  let acoes = m[1]!;
  while (/\([^()]*\)/.test(acoes)) acoes = acoes.replace(/\([^()]*\)/g, '');
  return acoes.split(',').some((a) => !/^\s*ADD\s+(COLUMN\s+)?(IF\s+NOT\s+EXISTS\s+)?"?\w/i.test(a) || /^\s*ADD\s+(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK)\b/i.test(a));
}

// Cada comando (até o `;`) é conferido sozinho. Nenhuma migration desliga, troca ou apaga gatilho de
// tabela nenhuma: os gatilhos do projeto são todos travas (do Histórico e do cad).
const VEDADOS: readonly [string, RegExp | ((comando: string) => boolean)][] = [
  ['gatilho desligado', /\b(DISABLE|ENABLE\s+(REPLICA|ALWAYS))\s+TRIGGER\b/i],
  ['session_replication_role', /\bsession_replication_role\b/i],
  ['DROP TRIGGER', /\bDROP\s+TRIGGER\b/i],
  ['troca de gatilho', /\bCREATE\s+OR\s+REPLACE\s+TRIGGER\b/i],
  // Gatilho ou regra novos no Histórico podem descartar a inserção em silêncio (RETURN NULL, DO INSTEAD).
  ['gatilho novo no Histórico', new RegExp(String.raw`\bCREATE\s+(CONSTRAINT\s+)?TRIGGER\b[\s\S]*\bON\s+${HIST}`, 'i')],
  ['regra no Histórico', new RegExp(String.raw`\bCREATE\s+(OR\s+REPLACE\s+)?RULE\b[\s\S]*\bTO\s+${HIST}`, 'i')],
  ['DROP TABLE do Histórico', new RegExp(String.raw`\bDROP\s+TABLE\b[\s\S]*${HIST}`, 'i')],
  ['DROP FUNCTION da trava', new RegExp(String.raw`\bDROP\s+FUNCTION\b[\s\S]*${TRAVA}`, 'i')],
  ['troca da função da trava', new RegExp(String.raw`\b(CREATE\s+OR\s+REPLACE|ALTER)\s+FUNCTION\b[\s\S]*${TRAVA}`, 'i')],
  ['ALTER TABLE do Histórico', alterTableVedado],
  ['GRANT de alteração no Histórico', new RegExp(String.raw`\bGRANT\b[\s\S]*\b(UPDATE|DELETE|TRUNCATE|ALL)\b[\s\S]*\bON\b[\s\S]*${HIST}`, 'i')],
  ['GRANT em todas as tabelas', /\bGRANT\b[\s\S]*\b(UPDATE|DELETE|TRUNCATE|ALL)\b[\s\S]*\bON\s+ALL\s+TABLES\b/i],
];

function violacoesHistorico(sql: string): string[] {
  const comandos = LIMPAR(sql).split(';');
  return VEDADOS.filter(([, regra]) => comandos.some((c) => (typeof regra === 'function' ? regra(c) : regra.test(c)))).map(([nome]) => nome);
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
    expect(violacoesHistorico('ALTER TABLE "historico_operacao" ADD COLUMN x text, DROP COLUMN ip;')).toEqual(['ALTER TABLE do Histórico']);
    expect(violacoesHistorico('ALTER TABLE "public"."historico_operacao" DROP COLUMN ip;')).toEqual(['ALTER TABLE do Histórico']);
    expect(violacoesHistorico('ALTER TABLE IF EXISTS ONLY historico_operacao RENAME TO h;')).toEqual(['ALTER TABLE do Histórico']);
    expect(violacoesHistorico('CREATE TRIGGER t BEFORE INSERT ON "historico_operacao" FOR EACH ROW EXECUTE FUNCTION nada();')).toEqual(['gatilho novo no Histórico']);
    expect(violacoesHistorico('CREATE RULE r AS ON INSERT TO "historico_operacao" DO INSTEAD NOTHING;')).toEqual(['regra no Histórico']);
    expect(violacoesHistorico("SELECT 'a--b'; DROP TRIGGER t ON x;")).toEqual(['DROP TRIGGER']);
    expect(violacoesHistorico('DO $$ BEGIN ALTER TABLE historico_operacao DROP COLUMN ip; END $$;')).toEqual(['ALTER TABLE do Histórico']);
    // Aceitos: coluna nova no Histórico (com tipo de vários argumentos) e tabela de nome parecido.
    expect(violacoesHistorico('ALTER TABLE "historico_operacao" ADD COLUMN "valor" numeric(15,2), ADD COLUMN "ia" text;')).toEqual([]);
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
