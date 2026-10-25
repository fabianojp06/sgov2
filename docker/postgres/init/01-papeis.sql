-- Papéis e bancos do dev local e dos testes (spec §11.5). hml e prod ficam na US-014.
-- Roda como superusuário só na criação do volume (docker-entrypoint-initdb.d) e no
-- helper de testes de integração. Senhas fixas de dev, documentadas no .env.example.
CREATE ROLE sgo_migrator LOGIN PASSWORD 'sgo_migrator' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE sgo_app LOGIN PASSWORD 'sgo_app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE sgo_sync LOGIN PASSWORD 'sgo_sync' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
-- Filas (pg-boss, US-010): o sgo_fila é dono só do schema pgboss (02-schema-filas.sql).
CREATE ROLE sgo_fila LOGIN PASSWORD 'sgo_fila' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- O dono do banco é dono do schema public (pg_database_owner, PostgreSQL 15+).
CREATE DATABASE sgo_dev OWNER sgo_migrator;
CREATE DATABASE sgo_shadow OWNER sgo_migrator;
CREATE DATABASE sgo_teste OWNER sgo_migrator;

-- search_path fixo: um papel que consiga criar schema não sequestra objetos sem qualificação
-- (padrão do CVE-2018-1058).
ALTER ROLE sgo_migrator SET search_path = public;
ALTER ROLE sgo_app SET search_path = public;
ALTER ROLE sgo_sync SET search_path = public;
ALTER ROLE sgo_fila SET search_path = pgboss;
