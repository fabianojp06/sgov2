-- CreateTable
CREATE TABLE "senioridade" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" TEXT NOT NULL,
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 100,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "senioridade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faixa_salarial" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cargo_id" UUID NOT NULL,
    "senioridade_id" UUID NOT NULL,
    "minimo" DECIMAL(15,2) NOT NULL,
    "maximo" DECIMAL(15,2) NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "faixa_salarial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "senioridade_nome_key" ON "senioridade"("nome");

-- CreateIndex
CREATE INDEX "faixa_salarial_cargo_id_idx" ON "faixa_salarial"("cargo_id");

-- AddForeignKey
ALTER TABLE "faixa_salarial" ADD CONSTRAINT "faixa_salarial_cargo_id_fkey" FOREIGN KEY ("cargo_id") REFERENCES "cargo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faixa_salarial" ADD CONSTRAINT "faixa_salarial_senioridade_id_fkey" FOREIGN KEY ("senioridade_id") REFERENCES "senioridade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Regras que o schema do Prisma não expressa (plano do P4, Task 12c; UC03.19).
-- RN_TAB_02: 0 < mínimo < máximo.
ALTER TABLE "faixa_salarial" ADD CONSTRAINT "faixa_salarial_valores_check" CHECK ("minimo" > 0 AND "minimo" < "maximo" AND "versao" >= 1);
ALTER TABLE "senioridade" ADD CONSTRAINT "senioridade_nome_check" CHECK (length(btrim("nome")) BETWEEN 1 AND 40);

-- RN_TAB_01 / E4: as padrão não se inativam nem mudam de nome; uma customizada só se inativa sem faixa ativa.
CREATE FUNCTION "cad_senioridade_regras"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."padrao" AND (NOT NEW."ativa" OR NEW."nome" IS DISTINCT FROM OLD."nome" OR NOT NEW."padrao") THEN
    RAISE EXCEPTION 'As senioridades padrão (Júnior, Pleno e Sênior) não podem ser inativadas nem renomeadas' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT OLD."padrao" AND NEW."padrao" THEN
    RAISE EXCEPTION 'Uma senioridade não vira padrão' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."ativa" AND NOT NEW."ativa" AND EXISTS (SELECT 1 FROM "faixa_salarial" WHERE "senioridade_id" = NEW."id" AND "ativa") THEN
    RAISE EXCEPTION 'A senioridade tem faixa salarial ativa' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "senioridade_regras" BEFORE UPDATE ON "senioridade" FOR EACH ROW EXECUTE FUNCTION "cad_senioridade_regras"();

CREATE FUNCTION "cad_faixa_salarial_atualizada"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."criado_em" IS DISTINCT FROM OLD."criado_em" THEN
    RAISE EXCEPTION 'O id e a criação de uma faixa salarial não mudam' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW IS DISTINCT FROM OLD THEN
    NEW."atualizado_em" := clock_timestamp();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "faixa_salarial_atualizada" BEFORE UPDATE ON "faixa_salarial" FOR EACH ROW EXECUTE FUNCTION "cad_faixa_salarial_atualizada"();

-- REQ_TAB_002: as padrão.
INSERT INTO "senioridade" ("nome", "padrao", "ordem") VALUES ('Júnior', true, 1), ('Pleno', true, 2), ('Sênior', true, 3);

-- Privilégios (B1): o app lê, inclui e altera (a exclusão é inativação); o sgo_sync não toca.
REVOKE ALL ON "senioridade", "faixa_salarial" FROM sgo_app, sgo_sync;
GRANT SELECT, INSERT ON "senioridade", "faixa_salarial" TO sgo_app;
GRANT UPDATE ("ativa") ON "senioridade" TO sgo_app;
GRANT UPDATE ("cargo_id", "senioridade_id", "minimo", "maximo", "ativa", "versao", "atualizado_em") ON "faixa_salarial" TO sgo_app;
