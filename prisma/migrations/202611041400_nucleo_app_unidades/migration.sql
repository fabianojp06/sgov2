-- US-007 (spec §5, C31): isolamento por unidade (TP) com RLS. A lista das unidades do usuário vem em
-- app.unidades, definida por set_config(..., true) em cada transação pelo shared/unidade
-- (emUnidade/aplicarUnidades). Sem a variável, ou vazia, a lista é vazia: a política não deixa ver
-- nada (falha fechada). A função é a base das políticas das tabelas de TP (R4 em diante):
--   ALTER TABLE <tabela> ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY <tabela>_unidade ON <tabela>
--     USING (unidade_id = ANY (app_unidades())) WITH CHECK (unidade_id = ANY (app_unidades()));
-- Sem FORCE: o dono (sgo_migrator) fica fora, para migrations e seeds; sgo_app e sgo_sync são
-- NOBYPASSRLS.
CREATE FUNCTION app_unidades() RETURNS uuid[]
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.unidades', true), ''), '{}')::uuid[]
$$;

-- A política roda a função com o privilégio de quem consulta: sem EXECUTE, toda leitura de tabela
-- de TP daria "permission denied" (as funções novas nascem sem EXECUTE para PUBLIC).
GRANT EXECUTE ON FUNCTION app_unidades() TO sgo_app, sgo_sync;
