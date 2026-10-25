-- Papéis e banco do SGO em hml e em prod (spec §11.5; US-014). O de dev é o
-- docker/postgres/init/01-papeis.sql.
--
-- O PO roda uma vez por ambiente, como superusuário, no banco postgres:
--   psql -X -U postgres -d postgres -f 01-papeis-ambiente.sql
-- As senhas vêm só do ambiente (SGO_SENHA_MIGRATOR, SGO_SENHA_APP, SGO_SENHA_SYNC,
-- SGO_SENHA_FILA e SGO_SENHA_LEITURA: diferentes entre si e com 16 caracteres ou mais), nunca
-- deste arquivo nem da linha de comando. Veja docs/operacao/ambientes.md.
--
-- Pode rodar de novo: cria só o que falta e reaplica atributos, configurações e privilégios.
-- Não troca a senha de papel que já existe (avisa quais; troca: \password, no ambientes.md).
-- Recusa, sem mudar nada, papel do SGO com membership ou configuração por banco: não há
-- como saber se foi de propósito, e qualquer um deles pode dar a um papel o poder de outro.
\set ON_ERROR_STOP on
\set QUIET on
SET client_min_messages = warning;
-- O servidor não grava nesta sessão os comandos, que levam as senhas em texto (o superusuário
-- pode mudar estes parâmetros só para a sessão).
SET log_statement = 'none';
SET log_min_duration_statement = -1;
SET log_min_duration_sample = -1;
SET log_transaction_sample_rate = 0;
SET log_min_error_statement = panic;
SET log_duration = off;
SET pg_stat_statements.track_utility = off;

-- Senhas. Variável ausente vira vazia e cai na checagem, que só mostra os nomes.
\getenv senha_migrator SGO_SENHA_MIGRATOR
\if :{?senha_migrator}
\else
\set senha_migrator ''
\endif
\getenv senha_app SGO_SENHA_APP
\if :{?senha_app}
\else
\set senha_app ''
\endif
\getenv senha_sync SGO_SENHA_SYNC
\if :{?senha_sync}
\else
\set senha_sync ''
\endif
\getenv senha_fila SGO_SENHA_FILA
\if :{?senha_fila}
\else
\set senha_fila ''
\endif
\getenv senha_leitura SGO_SENHA_LEITURA
\if :{?senha_leitura}
\else
\set senha_leitura ''
\endif

-- Checagens antes de qualquer mudança. Cada linha é um problema; nenhuma linha, nenhum problema.
SELECT string_agg(problema, '; ' ORDER BY problema) AS problemas
  FROM (
    SELECT 'senha ausente ou com menos de 16 caracteres: ' || string_agg(nome, ', ' ORDER BY nome)
      FROM (VALUES ('SGO_SENHA_MIGRATOR', :'senha_migrator'), ('SGO_SENHA_APP', :'senha_app'),
                   ('SGO_SENHA_SYNC', :'senha_sync'), ('SGO_SENHA_FILA', :'senha_fila'),
                   ('SGO_SENHA_LEITURA', :'senha_leitura')) AS s (nome, senha)
     WHERE length(senha) < 16
    HAVING count(*) > 0
    UNION ALL
    SELECT 'as cinco senhas precisam ser diferentes'
     WHERE (SELECT count(DISTINCT senha)
              FROM (VALUES (:'senha_migrator'), (:'senha_app'), (:'senha_sync'), (:'senha_fila'),
                           (:'senha_leitura')) AS s (senha)) < 5
    UNION ALL
    SELECT format('%s é membro de %s', pg_get_userbyid(member), pg_get_userbyid(roleid))
      FROM pg_auth_members
     WHERE pg_get_userbyid(member) LIKE 'sgo\_%' OR pg_get_userbyid(roleid) LIKE 'sgo\_%'
    UNION ALL
    SELECT format('%s tem configuração no banco %s (ALTER ROLE ... IN DATABASE)',
                  pg_get_userbyid(setrole), (SELECT datname FROM pg_database WHERE oid = setdatabase))
      FROM pg_db_role_setting
     WHERE setdatabase <> 0 AND pg_get_userbyid(setrole) LIKE 'sgo\_%'
  ) AS p (problema)
\gset
\if :{?problemas}
SET sgo.problemas = :'problemas';
DO $$ BEGIN
  RAISE EXCEPTION 'nada foi alterado: %', current_setting('sgo.problemas');
END $$;
\endif

-- Papéis com login que já existiam: ficam com a senha que têm.
SELECT string_agg(rolname, ', ' ORDER BY rolname) AS ja_existiam
  FROM pg_roles WHERE rolname IN ('sgo_migrator', 'sgo_app', 'sgo_sync', 'sgo_fila', 'sgo_leitura')
\gset

-- Papéis. As variáveis do psql não se expandem dentro de DO $$...$$, daí o \gexec.
-- sgo_admin: só dono do banco, sem login (o PO entra como postgres e usa SET ROLE se precisar).
SELECT 'CREATE ROLE sgo_admin NOLOGIN'
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sgo_admin') \gexec
SELECT format('CREATE ROLE sgo_migrator LOGIN PASSWORD %L', :'senha_migrator')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sgo_migrator') \gexec
SELECT format('CREATE ROLE sgo_app LOGIN PASSWORD %L', :'senha_app')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sgo_app') \gexec
SELECT format('CREATE ROLE sgo_sync LOGIN PASSWORD %L', :'senha_sync')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sgo_sync') \gexec
SELECT format('CREATE ROLE sgo_fila LOGIN PASSWORD %L', :'senha_fila')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sgo_fila') \gexec
SELECT format('CREATE ROLE sgo_leitura LOGIN PASSWORD %L', :'senha_leitura')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sgo_leitura') \gexec

-- Atributos reaplicados a cada execução: nenhum papel do SGO é superusuário nem ignora a RLS,
-- e nenhum tem limite de conexões ou validade que derrube o serviço mais tarde.
ALTER ROLE sgo_admin NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  INHERIT CONNECTION LIMIT -1 VALID UNTIL 'infinity';
ALTER ROLE sgo_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  INHERIT CONNECTION LIMIT -1 VALID UNTIL 'infinity';
ALTER ROLE sgo_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  INHERIT CONNECTION LIMIT -1 VALID UNTIL 'infinity';
ALTER ROLE sgo_sync LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  INHERIT CONNECTION LIMIT -1 VALID UNTIL 'infinity';
ALTER ROLE sgo_fila LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  INHERIT CONNECTION LIMIT -1 VALID UNTIL 'infinity';
-- sgo_leitura: comandos ad hoc (spec §11.5 item 5). Sem BYPASSRLS, enxerga só o que as
-- políticas deixam. O dump diário não usa este papel (Tarefa 7): roda como postgres.
ALTER ROLE sgo_leitura LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  INHERIT CONNECTION LIMIT -1 VALID UNTIL 'infinity';

-- Configurações: só as daqui. search_path fixo (padrão do CVE-2018-1058), como no dev.
ALTER ROLE sgo_admin RESET ALL;
ALTER ROLE sgo_migrator RESET ALL;
ALTER ROLE sgo_app RESET ALL;
ALTER ROLE sgo_sync RESET ALL;
ALTER ROLE sgo_fila RESET ALL;
ALTER ROLE sgo_leitura RESET ALL;
ALTER ROLE sgo_migrator SET search_path = public;
ALTER ROLE sgo_app SET search_path = public;
ALTER ROLE sgo_sync SET search_path = public;
ALTER ROLE sgo_fila SET search_path = pgboss;
ALTER ROLE sgo_leitura SET search_path = public;
-- Mesmo que alguém dê um grant a mais, a sessão do sgo_leitura não escreve.
ALTER ROLE sgo_leitura SET default_transaction_read_only = on;

-- Banco: dono é o sgo_admin, e não o migrator, que fica só com o schema public.
SELECT 'CREATE DATABASE sgo OWNER sgo_admin ENCODING ''UTF8'' TEMPLATE template0'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sgo') \gexec
ALTER DATABASE sgo OWNER TO sgo_admin;

-- Só os papéis do SGO conectam, e ninguém cria schema nem tabela temporária.
REVOKE ALL ON DATABASE sgo FROM PUBLIC, sgo_migrator, sgo_app, sgo_sync, sgo_fila, sgo_leitura;
GRANT CONNECT ON DATABASE sgo TO sgo_migrator, sgo_app, sgo_sync, sgo_fila, sgo_leitura;
REVOKE ALL ON DATABASE postgres FROM PUBLIC, sgo_migrator, sgo_app, sgo_sync, sgo_fila, sgo_leitura;
REVOKE ALL ON DATABASE template1 FROM PUBLIC, sgo_migrator, sgo_app, sgo_sync, sgo_fila, sgo_leitura;

\connect sgo
SET client_min_messages = warning;
SET log_statement = 'none';
SET log_min_duration_statement = -1;
SET log_min_error_statement = panic;

ALTER SCHEMA public OWNER TO sgo_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC, sgo_app, sgo_sync, sgo_fila, sgo_leitura;
GRANT USAGE ON SCHEMA public TO sgo_app, sgo_sync, sgo_leitura;

-- Filas (pg-boss, US-010): o sgo_fila é dono só do schema pgboss.
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION sgo_fila;
ALTER SCHEMA pgboss OWNER TO sgo_fila;
REVOKE ALL ON SCHEMA pgboss FROM PUBLIC, sgo_migrator, sgo_app, sgo_sync, sgo_leitura;

-- pgvector (spec: instalada desde a F0). Só o superusuário cria a extensão; a migration que
-- a usar escreve CREATE EXTENSION IF NOT EXISTS vector, que aqui não faz nada.
CREATE EXTENSION IF NOT EXISTS vector;

-- sgo_leitura: SELECT no que já existe e no que as migrations criarem.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO sgo_leitura;
ALTER DEFAULT PRIVILEGES FOR ROLE sgo_migrator IN SCHEMA public GRANT SELECT ON TABLES TO sgo_leitura;

-- Funções novas não nascem executáveis por todos: a migration dá GRANT EXECUTE a quem usa.
-- (Funções de trigger não precisam do privilégio.)
ALTER DEFAULT PRIVILEGES FOR ROLE sgo_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

\if :{?ja_existiam}
SET sgo.ja_existiam = :'ja_existiam';
DO $$ BEGIN
  RAISE WARNING 'papéis que já existiam e mantiveram a senha: %', current_setting('sgo.ja_existiam');
END $$;
\endif
