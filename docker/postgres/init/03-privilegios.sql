-- Mesma regra de hml e prod (deploy/postgres/01-papeis-ambiente.sql): funções que o migrator
-- criar não nascem executáveis por PUBLIC. A migration dá GRANT EXECUTE a quem usa, e o erro
-- aparece já no dev e nos testes. Default privileges valem por banco, daí o \connect.
\connect sgo_dev
ALTER DEFAULT PRIVILEGES FOR ROLE sgo_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
\connect sgo_teste
ALTER DEFAULT PRIVILEGES FOR ROLE sgo_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
