-- CreateEnum
CREATE TYPE "OrigemValorBeneficio" AS ENUM ('MESTRE', 'MANUAL');

-- CreateTable
CREATE TABLE "beneficio_cargo" (
    "cargo_id" UUID NOT NULL,
    "ano" SMALLINT NOT NULL,
    "codigo" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL,
    "valor_manual" DECIMAL(15,2),
    "origem" "OrigemValorBeneficio" NOT NULL DEFAULT 'MESTRE',
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "beneficio_cargo_pkey" PRIMARY KEY ("cargo_id","ano","codigo")
);

-- CreateIndex
CREATE INDEX "beneficio_cargo_ano_codigo_idx" ON "beneficio_cargo"("ano", "codigo");

-- AddForeignKey
ALTER TABLE "beneficio_cargo" ADD CONSTRAINT "beneficio_cargo_cargo_id_fkey" FOREIGN KEY ("cargo_id") REFERENCES "cargo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficio_cargo" ADD CONSTRAINT "beneficio_cargo_ano_codigo_fkey" FOREIGN KEY ("ano", "codigo") REFERENCES "beneficio_mestre"("ano", "codigo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Regras que o schema do Prisma não expressa (plano do P4, Task 13; RN_CAR_07): valor manual ⇔ origem MANUAL.
ALTER TABLE "beneficio_cargo" ADD CONSTRAINT "beneficio_cargo_origem_check" CHECK (
  ("origem" = 'MANUAL') = ("valor_manual" IS NOT NULL) AND ("valor_manual" IS NULL OR "valor_manual" >= 0)
);

-- Ano congelado não muda (a mesma função das tabelas do ano, Task 9a).
CREATE TRIGGER "beneficio_cargo_congelado" BEFORE INSERT OR UPDATE OR DELETE ON "beneficio_cargo"
  FOR EACH ROW EXECUTE FUNCTION "cad_exercicio_congelado"();

-- Privilégios (B1): o sgo_sync não toca; o app lê, inclui e altera só o conteúdo, sem apagar.
REVOKE ALL ON "beneficio_cargo" FROM sgo_app, sgo_sync;
GRANT SELECT, INSERT ON "beneficio_cargo" TO sgo_app;
GRANT UPDATE ("ativo", "valor_manual", "origem", "atualizado_em") ON "beneficio_cargo" TO sgo_app;
