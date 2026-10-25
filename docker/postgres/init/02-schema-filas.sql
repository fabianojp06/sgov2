-- Schema das filas (pg-boss, US-010) em cada banco de dev e de teste, já com o sgo_fila como
-- dono. O sgo_fila não pode criar outros schemas (sem CREATE no banco). Só dev e testes.
\connect sgo_dev
CREATE SCHEMA pgboss AUTHORIZATION sgo_fila;
\connect sgo_teste
CREATE SCHEMA pgboss AUTHORIZATION sgo_fila;
