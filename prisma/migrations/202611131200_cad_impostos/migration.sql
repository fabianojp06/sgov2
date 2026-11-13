-- Impostos e alíquotas com vigência (US-052, #74; UC03.01, REQ_TAX_001, RN_TAX_01/03/05/06). O
-- imposto (PIS, COFINS, ISS e os que a GFIN cadastrar) tem nome único sem diferenciar maiúsculas
-- (até 20 caracteres) e o tipo de incidência. As alíquotas formam o histórico por competência (o
-- primeiro dia do mês em que passam a valer): só se inclui alíquota de competência atual ou futura
-- (sem retroatividade, RN_TAX_05), e a que já começou a valer não muda nem sai (RN_TAX_06). O
-- congelamento no snapshot da proposta oficial (RN_TAX_03) é da frente A, pelo contrato do cad.

-- CreateEnum
CREATE TYPE "IncidenciaImposto" AS ENUM ('CONTRATO', 'TERMO_PARCERIA', 'AMBOS');

-- CreateTable
CREATE TABLE "imposto" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" TEXT NOT NULL,
    "incidencia" "IncidenciaImposto" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "imposto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aliquota_imposto" (
    "imposto_id" UUID NOT NULL,
    "competencia" DATE NOT NULL,
    "percentual" DECIMAL(9,4) NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "aliquota_imposto_pkey" PRIMARY KEY ("imposto_id","competencia")
);

-- AddForeignKey
ALTER TABLE "aliquota_imposto" ADD CONSTRAINT "aliquota_imposto_imposto_id_fkey" FOREIGN KEY ("imposto_id") REFERENCES "imposto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "imposto" ADD CONSTRAINT "imposto_regras_check" CHECK (
  char_length("nome") BETWEEN 1 AND 20 AND "nome" = btrim("nome") AND "versao" >= 1
);
CREATE UNIQUE INDEX "imposto_nome_key" ON "imposto" (lower("nome"));

ALTER TABLE "aliquota_imposto" ADD CONSTRAINT "aliquota_imposto_regras_check" CHECK (
  "percentual" >= 0 AND "percentual" <= 100 AND "competencia" = date_trunc('month', "competencia")::date
);

-- Histórico da alíquota (RN_TAX_05/06): incluir só na competência atual ou futura; a que já começou a
-- valer (competência <= mês atual) não muda nem sai. A futura pode ser removida antes de valer.
CREATE FUNCTION "cad_aliquota_imposto_regras"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mes_atual date := date_trunc('month', clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."competencia" < mes_atual THEN
      RAISE EXCEPTION 'Alíquota retroativa' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Alíquota não se altera: inclua uma nova vigência' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."competencia" <= mes_atual THEN
    RAISE EXCEPTION 'Alíquota em vigor ou passada não sai' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER "aliquota_imposto_regras" BEFORE INSERT OR UPDATE OR DELETE ON "aliquota_imposto"
  FOR EACH ROW EXECUTE FUNCTION "cad_aliquota_imposto_regras"();

CREATE FUNCTION "cad_imposto_imutavel"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."criado_em" IS DISTINCT FROM OLD."criado_em" THEN
    RAISE EXCEPTION 'O id do imposto não muda' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW IS DISTINCT FROM OLD THEN
    NEW."atualizado_em" := clock_timestamp();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "imposto_imutavel" BEFORE UPDATE ON "imposto"
  FOR EACH ROW EXECUTE FUNCTION "cad_imposto_imutavel"();

-- Privilégios: o app inclui e altera o imposto (nome, incidência, situação) e inclui ou remove
-- alíquota futura (o trigger decide); ninguém apaga imposto; o sgo_sync só lê.
REVOKE ALL ON "imposto", "aliquota_imposto" FROM sgo_app, sgo_sync;
GRANT SELECT ON "imposto", "aliquota_imposto" TO sgo_app, sgo_sync;
GRANT INSERT ("nome", "incidencia") ON "imposto" TO sgo_app;
GRANT UPDATE ("nome", "incidencia", "ativo", "versao", "atualizado_em") ON "imposto" TO sgo_app;
GRANT INSERT ("imposto_id", "competencia", "percentual") ON "aliquota_imposto" TO sgo_app;
GRANT DELETE ON "aliquota_imposto" TO sgo_app;
