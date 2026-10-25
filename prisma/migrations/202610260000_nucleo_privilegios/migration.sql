-- Privilégios do núcleo (spec §11.5). Roda como sgo_migrator, dono do schema public.
-- Ninguém além do migrator cria objetos; sgo_app e sgo_sync só manipulam dados.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO sgo_app, sgo_sync;

ALTER DEFAULT PRIVILEGES FOR ROLE sgo_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sgo_app, sgo_sync;
ALTER DEFAULT PRIVILEGES FOR ROLE sgo_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO sgo_app, sgo_sync;
