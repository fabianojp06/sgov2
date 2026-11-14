-- Rateio e ISS da proposta de TP (US-073; plano do P24, Task 1). SQL à mão, no formato que o Prisma gera para o
-- schema (orc.prisma), conferido pelos testes de integração. Nenhuma tabela da frente B é tocada.

-- 1) A grade, uma por versão (D-P24-1 a D-P24-7): a conta sintética mandante (a base, RN_RAT_06), o modo da
--    distribuição e a alíquota de ISS (só no Contrato, de 2% a 5%; o valor do ISS fica a definir, GAP-CAD-001).
-- CreateTable
CREATE TABLE "orc_rateio" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "unidade_id" UUID NOT NULL,
    "versao_proposta_id" UUID NOT NULL,
    "conta_sintetica" TEXT NOT NULL,
    "modo" TEXT NOT NULL,
    "aliquota_iss" DECIMAL(9,4),
    "criado_por" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "versao" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "orc_rateio_pkey" PRIMARY KEY ("id")
);

-- 2) As células da grade (RN_RAT_01, RN_RAT_03): conta analítica de destino × competência, com o valor em R$ e,
--    no modo percentual, o % da base. Célula vazia não é gravada (não declarada); o zero digitado é gravado,
--    porque o envio exige todas as células declaradas (C1, RN_WA01_002).
-- CreateTable
CREATE TABLE "orc_rateio_celula" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "unidade_id" UUID NOT NULL,
    "rateio_id" UUID NOT NULL,
    "conta" TEXT NOT NULL,
    "competencia" DATE NOT NULL,
    "valor" DECIMAL(15,2) NOT NULL,
    "percentual" DECIMAL(9,4),

    CONSTRAINT "orc_rateio_celula_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orc_rateio_versao_proposta_id_key" ON "orc_rateio"("versao_proposta_id");

-- CreateIndex
CREATE INDEX "orc_rateio_unidade_id_idx" ON "orc_rateio"("unidade_id");

-- CreateIndex
CREATE INDEX "orc_rateio_celula_unidade_id_idx" ON "orc_rateio_celula"("unidade_id");

-- CreateIndex
CREATE UNIQUE INDEX "orc_rateio_celula_rateio_id_conta_competencia_key" ON "orc_rateio_celula"("rateio_id", "conta", "competencia");

-- AddForeignKey
ALTER TABLE "orc_rateio" ADD CONSTRAINT "orc_rateio_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_rateio" ADD CONSTRAINT "orc_rateio_versao_proposta_id_fkey" FOREIGN KEY ("versao_proposta_id") REFERENCES "orc_versao_proposta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_rateio_celula" ADD CONSTRAINT "orc_rateio_celula_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_rateio_celula" ADD CONSTRAINT "orc_rateio_celula_rateio_id_fkey" FOREIGN KEY ("rateio_id") REFERENCES "orc_rateio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3) Regras (E2, RN_RAT_01, D-P24-3). Os limites espelham o domain/rateio.ts.
ALTER TABLE "orc_rateio"
  ADD CONSTRAINT "orc_rateio_conta_check" CHECK (char_length(btrim("conta_sintetica")) >= 1),
  ADD CONSTRAINT "orc_rateio_modo_check" CHECK ("modo" IN ('PERCENTUAL', 'VALOR')),
  ADD CONSTRAINT "orc_rateio_iss_check" CHECK ("aliquota_iss" IS NULL OR "aliquota_iss" BETWEEN 2 AND 5),
  ADD CONSTRAINT "orc_rateio_versao_check" CHECK ("versao" >= 0);

ALTER TABLE "orc_rateio_celula"
  ADD CONSTRAINT "orc_rateio_celula_conta_check" CHECK (char_length(btrim("conta")) >= 1),
  ADD CONSTRAINT "orc_rateio_celula_competencia_check" CHECK (extract(day FROM "competencia") = 1),
  ADD CONSTRAINT "orc_rateio_celula_valor_check" CHECK ("valor" >= 0),
  ADD CONSTRAINT "orc_rateio_celula_percentual_check" CHECK ("percentual" IS NULL OR ("percentual" >= 0 AND "percentual" <= 100));

-- A grade é da mesma unidade da versão (a função do teto de viagens, P21), e a célula, da mesma unidade da grade.
CREATE TRIGGER orc_rateio_mesma_unidade BEFORE INSERT OR UPDATE OF "unidade_id", "versao_proposta_id" ON "orc_rateio"
  FOR EACH ROW EXECUTE FUNCTION orc_teto_viagem_mesma_unidade();

CREATE FUNCTION orc_rateio_celula_mesma_unidade() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "orc_rateio" r WHERE r.id = NEW.rateio_id AND r.unidade_id = NEW.unidade_id) THEN
    RAISE EXCEPTION 'orc.pessoal_outra_unidade' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER orc_rateio_celula_mesma_unidade BEFORE INSERT OR UPDATE OF "unidade_id", "rateio_id" ON "orc_rateio_celula"
  FOR EACH ROW EXECUTE FUNCTION orc_rateio_celula_mesma_unidade();
REVOKE EXECUTE ON FUNCTION orc_rateio_celula_mesma_unidade() FROM PUBLIC;

-- 4) RLS por unidade (US-007): a política padrão.
ALTER TABLE "orc_rateio" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orc_rateio_unidade" ON "orc_rateio"
  USING (unidade_id = ANY ((SELECT app_unidades())::uuid[])) WITH CHECK (unidade_id = ANY ((SELECT app_unidades())::uuid[]));
ALTER TABLE "orc_rateio_celula" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orc_rateio_celula_unidade" ON "orc_rateio_celula"
  USING (unidade_id = ANY ((SELECT app_unidades())::uuid[])) WITH CHECK (unidade_id = ANY ((SELECT app_unidades())::uuid[]));

-- 5) Privilégios (spec §11.5). O sincronismo do ERP não toca no rateio. Na grade, mudam só a sintética, o modo
--    e a alíquota; as células são regravadas inteiras (apagar e inserir), sem UPDATE.
REVOKE ALL ON "orc_rateio" FROM sgo_sync;
REVOKE UPDATE ON "orc_rateio" FROM sgo_app;
GRANT UPDATE ("conta_sintetica", "modo", "aliquota_iss", "versao") ON "orc_rateio" TO sgo_app;
REVOKE ALL ON "orc_rateio_celula" FROM sgo_sync;
REVOKE UPDATE ON "orc_rateio_celula" FROM sgo_app;
