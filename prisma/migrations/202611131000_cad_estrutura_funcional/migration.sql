-- Estrutura funcional (US-048, #70; UC03.18; C2 e RN_CAR_08 do C&S V4): a árvore de unidades da
-- instituição e o vínculo 1:1 do cargo com uma unidade analítica. O rateio percentual entre setores
-- (RN_EST_03, E4) foi revogado pela C2.
-- Hierarquia (REQ_EST_002, E1): Diretoria e Gerência são sintéticas (só consolidam); Assessoria,
-- Coordenadoria e Setor são analíticas (onde os cargos ficam).
--   Diretoria: sem superior.            Gerência: sem superior ou sob uma Diretoria.
--   Assessoria: sob uma Diretoria.      Coordenadoria e Setor: sob uma Gerência.
-- Analítica não tem unidade abaixo. O tipo e o superior não mudam depois da inclusão (só nome e
-- situação): mover uma unidade mudaria a consolidação de quem já está nela.

-- CreateEnum
CREATE TYPE "TipoUnidadeFuncional" AS ENUM ('DIRETORIA', 'GERENCIA', 'ASSESSORIA', 'COORDENADORIA', 'SETOR');

-- CreateTable
CREATE TABLE "unidade_funcional" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" TEXT NOT NULL,
    "tipo" "TipoUnidadeFuncional" NOT NULL,
    "superior_id" UUID,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "unidade_funcional_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "unidade_funcional_superior_id_idx" ON "unidade_funcional"("superior_id");

-- AddForeignKey
ALTER TABLE "unidade_funcional" ADD CONSTRAINT "unidade_funcional_superior_id_fkey" FOREIGN KEY ("superior_id") REFERENCES "unidade_funcional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Vínculo do cargo (R11 deixou a coluna sem FK até esta história).
ALTER TABLE "cargo" ADD CONSTRAINT "cargo_vinculo_funcional_id_fkey" FOREIGN KEY ("vinculo_funcional_id") REFERENCES "unidade_funcional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "cargo_vinculo_funcional_id_idx" ON "cargo"("vinculo_funcional_id");

ALTER TABLE "unidade_funcional" ADD CONSTRAINT "unidade_funcional_regras_check" CHECK (
  char_length(btrim("nome")) BETWEEN 1 AND 120 AND "nome" = btrim("nome") AND "versao" >= 1
  AND ("superior_id" IS NULL OR "superior_id" <> "id")
);

-- Nome único entre as unidades ativas do mesmo superior, sem diferenciar maiúsculas.
CREATE UNIQUE INDEX "unidade_funcional_nome_ativa_key" ON "unidade_funcional"
  (COALESCE("superior_id", '00000000-0000-0000-0000-000000000000'::uuid), lower("nome")) WHERE "ativa";

-- Hierarquia, imutabilidade do tipo e do superior e a inativação (RN_EST_04, E3).
CREATE FUNCTION "cad_unidade_funcional_regras"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tipo_superior "TipoUnidadeFuncional";
  superior_ativa boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."tipo" IS DISTINCT FROM OLD."tipo" OR NEW."superior_id" IS DISTINCT FROM OLD."superior_id"
       OR NEW."id" IS DISTINCT FROM OLD."id" OR NEW."criado_em" IS DISTINCT FROM OLD."criado_em" THEN
      RAISE EXCEPTION 'O tipo e a unidade superior não mudam' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."ativa" AND NOT NEW."ativa" THEN
      IF EXISTS (SELECT 1 FROM "cargo" WHERE "vinculo_funcional_id" = NEW."id" AND "ativo") THEN
        RAISE EXCEPTION 'Unidade com cargos ativos vinculados' USING ERRCODE = 'check_violation';
      END IF;
      IF EXISTS (SELECT 1 FROM "unidade_funcional" WHERE "superior_id" = NEW."id" AND "ativa") THEN
        RAISE EXCEPTION 'Unidade com unidades ativas abaixo' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF NOT OLD."ativa" AND NEW."ativa" AND NEW."superior_id" IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM "unidade_funcional" WHERE "id" = NEW."superior_id" AND "ativa") THEN
      RAISE EXCEPTION 'A unidade superior está inativa' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW IS DISTINCT FROM OLD THEN
      NEW."atualizado_em" := clock_timestamp();
    END IF;
    RETURN NEW;
  END IF;
  -- INSERT: a combinação de tipos (REQ_EST_002, E1).
  IF NEW."superior_id" IS NULL THEN
    IF NEW."tipo" NOT IN ('DIRETORIA', 'GERENCIA') THEN
      RAISE EXCEPTION 'Unidade analítica precisa de unidade superior' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT "tipo", "ativa" INTO tipo_superior, superior_ativa FROM "unidade_funcional" WHERE "id" = NEW."superior_id";
  IF NOT superior_ativa THEN
    RAISE EXCEPTION 'A unidade superior está inativa' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (
    (NEW."tipo" = 'GERENCIA' AND tipo_superior = 'DIRETORIA')
    OR (NEW."tipo" = 'ASSESSORIA' AND tipo_superior = 'DIRETORIA')
    OR (NEW."tipo" IN ('COORDENADORIA', 'SETOR') AND tipo_superior = 'GERENCIA')
  ) THEN
    RAISE EXCEPTION 'Vínculo hierárquico inválido' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "unidade_funcional_regras" BEFORE INSERT OR UPDATE ON "unidade_funcional"
  FOR EACH ROW EXECUTE FUNCTION "cad_unidade_funcional_regras"();

-- Cargo só se vincula a unidade analítica e ativa (RN_EST_02, RN_CAR_08); desvincular é permitido.
CREATE FUNCTION "cad_cargo_vinculo_funcional"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."vinculo_funcional_id" IS NOT NULL AND NEW."vinculo_funcional_id" IS DISTINCT FROM OLD."vinculo_funcional_id"
     AND NOT EXISTS (SELECT 1 FROM "unidade_funcional" WHERE "id" = NEW."vinculo_funcional_id" AND "ativa"
                     AND "tipo" IN ('ASSESSORIA', 'COORDENADORIA', 'SETOR')) THEN
    RAISE EXCEPTION 'Cargo só se vincula a unidade analítica ativa' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "cargo_vinculo_funcional" BEFORE UPDATE OF "vinculo_funcional_id" ON "cargo"
  FOR EACH ROW EXECUTE FUNCTION "cad_cargo_vinculo_funcional"();

-- Privilégios: o app inclui, renomeia e (in)ativa, sem apagar; o sgo_sync lê (a recarga do Rubi não
-- mexe no vínculo, que é campo manual do cargo).
REVOKE ALL ON "unidade_funcional" FROM sgo_app, sgo_sync;
GRANT SELECT ON "unidade_funcional" TO sgo_app, sgo_sync;
GRANT INSERT ("nome", "tipo", "superior_id") ON "unidade_funcional" TO sgo_app;
GRANT UPDATE ("nome", "ativa", "versao", "atualizado_em") ON "unidade_funcional" TO sgo_app;
