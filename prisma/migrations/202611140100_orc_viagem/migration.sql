-- Viagens da proposta de TP (US-071; plano do P21, Task 1). SQL à mão, no formato que o Prisma gera para o
-- schema (orc.prisma), conferido pelos testes de integração. Nenhuma tabela da frente B é tocada.

-- 1) Teto de viagens por conta sintética da versão (Camada 1, C6; D-P21-5, decisão do PO de 13/11/2026):
--    informado, maior que zero (E5). A conta é a classificação do C1 (R5), sem FK, como no resto do orc.
-- CreateTable
CREATE TABLE "orc_teto_viagem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "unidade_id" UUID NOT NULL,
    "versao_proposta_id" UUID NOT NULL,
    "conta_sintetica" TEXT NOT NULL,
    "valor" DECIMAL(15,2) NOT NULL,
    "criado_por" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "versao" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "orc_teto_viagem_pkey" PRIMARY KEY ("id")
);

-- 2) Viagem da versão (Camada 2, Viagens V3; D-P21-2 a D-P21-4): meta obrigatória na categoria Meta (no caso
--    de uso) com FK RESTRICT (RN_VIA_04, RN0136). O custo não é gravado (RN_VIA_03 read-only, REQ0212).
-- CreateTable
CREATE TABLE "orc_viagem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "unidade_id" UUID NOT NULL,
    "versao_proposta_id" UUID NOT NULL,
    "meta_id" UUID,
    "localidade" TEXT NOT NULL,
    "pessoas" INTEGER NOT NULL,
    "dias" INTEGER NOT NULL,
    "valor_passagem" DECIMAL(15,2) NOT NULL,
    "valor_diaria" DECIMAL(15,2) NOT NULL,
    "valor_transporte" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "conta_passagem" TEXT NOT NULL,
    "conta_diaria" TEXT NOT NULL,
    "conta_transporte" TEXT,
    "criado_por" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "versao" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "orc_viagem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orc_teto_viagem_unidade_id_idx" ON "orc_teto_viagem"("unidade_id");

-- CreateIndex
CREATE UNIQUE INDEX "orc_teto_viagem_versao_conta_key" ON "orc_teto_viagem"("versao_proposta_id", "conta_sintetica");

-- CreateIndex
CREATE INDEX "orc_viagem_unidade_id_idx" ON "orc_viagem"("unidade_id");

-- CreateIndex
CREATE INDEX "orc_viagem_versao_proposta_id_idx" ON "orc_viagem"("versao_proposta_id");

-- CreateIndex
CREATE INDEX "orc_viagem_meta_id_idx" ON "orc_viagem"("meta_id");

-- AddForeignKey
ALTER TABLE "orc_teto_viagem" ADD CONSTRAINT "orc_teto_viagem_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_teto_viagem" ADD CONSTRAINT "orc_teto_viagem_versao_proposta_id_fkey" FOREIGN KEY ("versao_proposta_id") REFERENCES "orc_versao_proposta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_viagem" ADD CONSTRAINT "orc_viagem_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_viagem" ADD CONSTRAINT "orc_viagem_versao_proposta_id_fkey" FOREIGN KEY ("versao_proposta_id") REFERENCES "orc_versao_proposta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_viagem" ADD CONSTRAINT "orc_viagem_meta_id_fkey" FOREIGN KEY ("meta_id") REFERENCES "orc_meta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3) Regras (Viagens V3, RN_VIA_06, D-P21-2 a D-P21-5). Os limites espelham o domain/viagem.ts.
ALTER TABLE "orc_teto_viagem"
  ADD CONSTRAINT "orc_teto_viagem_conta_check" CHECK (char_length(btrim("conta_sintetica")) >= 1),
  ADD CONSTRAINT "orc_teto_viagem_valor_check" CHECK ("valor" > 0),
  ADD CONSTRAINT "orc_teto_viagem_versao_check" CHECK ("versao" >= 0);

ALTER TABLE "orc_viagem"
  ADD CONSTRAINT "orc_viagem_localidade_check" CHECK (char_length(btrim("localidade")) BETWEEN 1 AND 100),
  ADD CONSTRAINT "orc_viagem_pessoas_check" CHECK ("pessoas" BETWEEN 1 AND 9999),
  ADD CONSTRAINT "orc_viagem_dias_check" CHECK ("dias" BETWEEN 1 AND 9999),
  ADD CONSTRAINT "orc_viagem_valores_check" CHECK ("valor_passagem" >= 0 AND "valor_diaria" >= 0 AND "valor_transporte" >= 0),
  ADD CONSTRAINT "orc_viagem_contas_check" CHECK (char_length(btrim("conta_passagem")) >= 1 AND char_length(btrim("conta_diaria")) >= 1),
  ADD CONSTRAINT "orc_viagem_transporte_check" CHECK ("valor_transporte" = 0 OR "conta_transporte" IS NOT NULL),
  ADD CONSTRAINT "orc_viagem_versao_check" CHECK ("versao" >= 0);

-- A viagem e o teto são da mesma unidade da versão, e a meta da viagem (quando há) é da mesma versão: a
-- função do pessoal (P20) vale para a viagem, que tem as mesmas colunas; o teto, sem meta, tem a sua.
CREATE TRIGGER orc_viagem_mesma_versao BEFORE INSERT OR UPDATE OF "unidade_id", "versao_proposta_id", "meta_id" ON "orc_viagem"
  FOR EACH ROW EXECUTE FUNCTION orc_pessoal_mesma_versao();

CREATE FUNCTION orc_teto_viagem_mesma_unidade() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "orc_versao_proposta" v WHERE v.id = NEW.versao_proposta_id AND v.unidade_id = NEW.unidade_id) THEN
    RAISE EXCEPTION 'orc.pessoal_outra_unidade' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER orc_teto_viagem_mesma_unidade BEFORE INSERT OR UPDATE OF "unidade_id", "versao_proposta_id" ON "orc_teto_viagem"
  FOR EACH ROW EXECUTE FUNCTION orc_teto_viagem_mesma_unidade();
REVOKE EXECUTE ON FUNCTION orc_teto_viagem_mesma_unidade() FROM PUBLIC;

-- 4) RLS por unidade (US-007): a política padrão.
ALTER TABLE "orc_teto_viagem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orc_teto_viagem_unidade" ON "orc_teto_viagem"
  USING (unidade_id = ANY ((SELECT app_unidades())::uuid[])) WITH CHECK (unidade_id = ANY ((SELECT app_unidades())::uuid[]));
ALTER TABLE "orc_viagem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orc_viagem_unidade" ON "orc_viagem"
  USING (unidade_id = ANY ((SELECT app_unidades())::uuid[])) WITH CHECK (unidade_id = ANY ((SELECT app_unidades())::uuid[]));

-- 5) Privilégios (spec §11.5). O sincronismo do ERP não toca nas viagens. A aplicação insere, lê e apaga
--    (exclusão física, UC03.33). No teto, só o valor muda; na viagem, a versão, a meta, as contas de
--    passagem e de diária e a unidade não mudam (RN_VIA_07). A conta de transporte pode ser escolhida no
--    alterar enquanto não houver uma (D-P21-6).
REVOKE ALL ON "orc_teto_viagem" FROM sgo_sync;
REVOKE UPDATE ON "orc_teto_viagem" FROM sgo_app;
GRANT UPDATE ("valor", "versao") ON "orc_teto_viagem" TO sgo_app;
REVOKE ALL ON "orc_viagem" FROM sgo_sync;
REVOKE UPDATE ON "orc_viagem" FROM sgo_app;
GRANT UPDATE ("localidade", "pessoas", "dias", "valor_passagem", "valor_diaria", "valor_transporte", "conta_transporte", "versao") ON "orc_viagem" TO sgo_app;
