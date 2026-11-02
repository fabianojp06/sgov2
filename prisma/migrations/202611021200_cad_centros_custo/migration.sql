-- CreateEnum
CREATE TYPE "TipoCentroCusto" AS ENUM ('SINTETICO', 'ANALITICO');

-- CreateEnum
CREATE TYPE "NaturezaCentroCusto" AS ENUM ('FINALISTICO', 'APOIO', 'ADMINISTRATIVO', 'GESTAO');

-- CreateTable
CREATE TABLE "centro_custo" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "classificacao" TEXT NOT NULL,
    "codigo_reduzido" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "descricao_original" TEXT,
    "nivel" SMALLINT NOT NULL,
    "tipo" "TipoCentroCusto" NOT NULL,
    "pai_id" UUID,
    "aceita_lancamento" BOOLEAN NOT NULL,
    "de_gestao" BOOLEAN NOT NULL DEFAULT false,
    "natureza" "NaturezaCentroCusto",
    "provisorio" BOOLEAN NOT NULL DEFAULT true,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "inativado_em" TIMESTAMPTZ(6),
    "carga_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "centro_custo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "centro_custo_classificacao_key" ON "centro_custo"("classificacao");

-- CreateIndex
CREATE INDEX "centro_custo_pai_id_idx" ON "centro_custo"("pai_id");

-- AddForeignKey
ALTER TABLE "centro_custo" ADD CONSTRAINT "centro_custo_pai_id_fkey" FOREIGN KEY ("pai_id") REFERENCES "centro_custo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "centro_custo" ADD CONSTRAINT "centro_custo_carga_id_fkey" FOREIGN KEY ("carga_id") REFERENCES "carga_estrutura"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Regras que o schema do Prisma não expressa (plano do P4, Task 5; spec §6.1a). Sem CHECK do
-- formato do reduzido: a numeração ainda pode mudar (GAP-CC-003, R17).
ALTER TABLE "centro_custo" ADD CONSTRAINT "centro_custo_regras_check" CHECK (
  "nivel" BETWEEN 1 AND 5
  AND "classificacao" ~ '^[0-9]+(\.[0-9]+)*$'
  AND array_length(string_to_array("classificacao", '.'), 1) = "nivel"
  AND "aceita_lancamento" = ("tipo" = 'ANALITICO')
  AND ("tipo" = 'SINTETICO' OR "nivel" >= 2)
  AND ("nivel" = 1) = ("pai_id" IS NULL)
  AND "ativo" = ("inativado_em" IS NULL)
  AND (NOT "de_gestao" OR "tipo" = 'ANALITICO')
  AND length("descricao") BETWEEN 1 AND 200
);
CREATE UNIQUE INDEX "centro_custo_reduzido_ativo_key" ON "centro_custo" ("codigo_reduzido") WHERE "ativo";

-- R5: a estrutura de um CC nunca muda; a recarga só muda descrição, situação e o provisório.
CREATE FUNCTION "cad_cc_imutavel"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."classificacao" IS DISTINCT FROM OLD."classificacao" OR NEW."nivel" IS DISTINCT FROM OLD."nivel"
    OR NEW."tipo" IS DISTINCT FROM OLD."tipo" OR NEW."pai_id" IS DISTINCT FROM OLD."pai_id"
    OR NEW."codigo_reduzido" IS DISTINCT FROM OLD."codigo_reduzido" OR NEW."id" IS DISTINCT FROM OLD."id" THEN
    RAISE EXCEPTION 'A estrutura de um centro de custo não muda (classificação, nível, tipo, pai e reduzido)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW IS DISTINCT FROM OLD THEN
    NEW."atualizado_em" := clock_timestamp();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "centro_custo_imutavel" BEFORE UPDATE ON "centro_custo"
  FOR EACH ROW EXECUTE FUNCTION "cad_cc_imutavel"();

-- Árvore coerente no fim da transação (como a do plano de contas): pai sintético, do nível acima e
-- prefixo; ativo com pai ativo (M-n3); sintético ativo com pelo menos um filho ativo.
CREATE FUNCTION "cad_cc_arvore"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  pai "centro_custo";
  atual "centro_custo";
BEGIN
  SELECT * INTO atual FROM "centro_custo" WHERE "id" = NEW."id";
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF atual."pai_id" IS NOT NULL THEN
    SELECT * INTO pai FROM "centro_custo" WHERE "id" = atual."pai_id";
    IF pai."tipo" <> 'SINTETICO' OR pai."nivel" <> atual."nivel" - 1
      OR left(atual."classificacao", length(pai."classificacao") + 1) <> pai."classificacao" || '.' THEN
      RAISE EXCEPTION 'Centro de custo % fora da árvore: o pai deve ser sintético, do nível acima e prefixo da classificação',
        atual."classificacao" USING ERRCODE = 'check_violation';
    END IF;
    IF atual."ativo" AND NOT pai."ativo" THEN
      RAISE EXCEPTION 'Centro de custo % ativo sob pai inativo', atual."classificacao" USING ERRCODE = 'check_violation';
    END IF;
    IF pai."ativo" AND NOT EXISTS (SELECT 1 FROM "centro_custo" WHERE "pai_id" = pai."id" AND "ativo") THEN
      RAISE EXCEPTION 'Centro de custo sintético % ativo sem filho ativo', pai."classificacao" USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF atual."tipo" = 'SINTETICO' AND atual."ativo"
    AND NOT EXISTS (SELECT 1 FROM "centro_custo" WHERE "pai_id" = atual."id" AND "ativo") THEN
    RAISE EXCEPTION 'Centro de custo sintético % ativo sem filho ativo', atual."classificacao" USING ERRCODE = 'check_violation';
  END IF;
  IF NOT atual."ativo" AND EXISTS (SELECT 1 FROM "centro_custo" WHERE "pai_id" = atual."id" AND "ativo") THEN
    RAISE EXCEPTION 'Centro de custo % inativo com filho ativo', atual."classificacao" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "centro_custo_arvore" AFTER INSERT OR UPDATE ON "centro_custo"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "cad_cc_arvore"();

-- Privilégios (R6): o app só lê; o merge é do sgo_sync no worker; ninguém além do migrator apaga.
REVOKE ALL ON "centro_custo" FROM sgo_app, sgo_sync;
GRANT SELECT ON "centro_custo" TO sgo_app;
GRANT SELECT, INSERT, UPDATE ON "centro_custo" TO sgo_sync;
