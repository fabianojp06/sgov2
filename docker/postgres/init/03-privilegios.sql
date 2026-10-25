-- Mesmas regras de hml e prod (deploy/postgres/01-papeis-ambiente.sql), para o erro aparecer
-- já no dev e nos testes, e não só em hml:
-- - ninguém cria tabela temporária;
-- - funções que o migrator criar não nascem executáveis por PUBLIC: a migration dá
--   GRANT EXECUTE a quem usa. Default privileges valem por banco, daí o \connect.
-- Volume de dev que já existe: aplicar à mão (só privilégios), como em docs/operacao/ambientes.md.
REVOKE TEMPORARY ON DATABASE sgo_dev FROM PUBLIC;
REVOKE TEMPORARY ON DATABASE sgo_teste FROM PUBLIC;
\connect sgo_dev
ALTER DEFAULT PRIVILEGES FOR ROLE sgo_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
\connect sgo_teste
ALTER DEFAULT PRIVILEGES FOR ROLE sgo_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
