-- Lote de validação das viagens (US-081; plano do P28, Task 1). SQL à mão, no formato que o Prisma gera para o
-- schema (orc.prisma), conferido pelos testes de integração. Nenhuma tabela da frente B é tocada.

-- O lote de viagens enviado ao WA02 (UC6.02; D-P28-2 a D-P28-6): nasce Em Validação; a validação o leva a
-- Validado, a rejeição a Rejeitado. Uma versão pode ter vários lotes ao longo do tempo (rejeitar e pedir de novo).
-- CreateTable
CREATE TABLE "orc_lote_viagem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "unidade_id" UUID NOT NULL,
    "versao_proposta_id" UUID NOT NULL,
    "situacao" TEXT NOT NULL DEFAULT 'EM_VALIDACAO',
    "solicitado_por" UUID NOT NULL,
    "viagens" UUID[],
    "versao" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "orc_lote_viagem_pkey" PRIMARY KEY ("id")
);

-- A viagem aponta o lote em que foi enviada por último (nulo: Pendente, D-P28-8).
-- AlterTable
ALTER TABLE "orc_viagem" ADD COLUMN "lote_viagem_id" UUID;

-- CreateIndex
CREATE INDEX "orc_lote_viagem_unidade_id_idx" ON "orc_lote_viagem"("unidade_id");

-- CreateIndex
CREATE INDEX "orc_lote_viagem_versao_proposta_id_idx" ON "orc_lote_viagem"("versao_proposta_id");

-- CreateIndex
CREATE INDEX "orc_viagem_lote_viagem_id_idx" ON "orc_viagem"("lote_viagem_id");

-- AddForeignKey
ALTER TABLE "orc_lote_viagem" ADD CONSTRAINT "orc_lote_viagem_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_lote_viagem" ADD CONSTRAINT "orc_lote_viagem_versao_proposta_id_fkey" FOREIGN KEY ("versao_proposta_id") REFERENCES "orc_versao_proposta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_viagem" ADD CONSTRAINT "orc_viagem_lote_viagem_id_fkey" FOREIGN KEY ("lote_viagem_id") REFERENCES "orc_lote_viagem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "orc_lote_viagem"
  ADD CONSTRAINT "orc_lote_viagem_situacao_check" CHECK ("situacao" IN ('EM_VALIDACAO', 'VALIDADO', 'REJEITADO')),
  ADD CONSTRAINT "orc_lote_viagem_versao_check" CHECK ("versao" >= 0);

CREATE TRIGGER orc_lote_viagem_mesma_unidade BEFORE INSERT OR UPDATE OF "unidade_id", "versao_proposta_id" ON "orc_lote_viagem"
  FOR EACH ROW EXECUTE FUNCTION orc_teto_viagem_mesma_unidade();

-- A viagem só aponta lote da mesma versão e unidade dela (revisão 12.12): sem isso, um UPDATE do lote_viagem_id
-- para um lote Validado de outro TP faria a viagem entrar no cronograma sem passar pelo WA02 (E3, RN_WA02_007).
CREATE FUNCTION orc_viagem_lote_mesma_versao() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.lote_viagem_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "orc_lote_viagem" l
    WHERE l.id = NEW.lote_viagem_id AND l.versao_proposta_id = NEW.versao_proposta_id AND l.unidade_id = NEW.unidade_id
  ) THEN
    RAISE EXCEPTION 'orc.viagem_lote_outra_versao' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER orc_viagem_lote_mesma_versao BEFORE INSERT OR UPDATE OF "lote_viagem_id", "versao_proposta_id", "unidade_id" ON "orc_viagem"
  FOR EACH ROW EXECUTE FUNCTION orc_viagem_lote_mesma_versao();
REVOKE EXECUTE ON FUNCTION orc_viagem_lote_mesma_versao() FROM PUBLIC;

ALTER TABLE "orc_lote_viagem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orc_lote_viagem_unidade" ON "orc_lote_viagem"
  USING (unidade_id = ANY ((SELECT app_unidades())::uuid[])) WITH CHECK (unidade_id = ANY ((SELECT app_unidades())::uuid[]));

-- Privilégios (spec §11.5): a aplicação insere, lê e muda só a situação e a versão do lote; na viagem, também o
-- lote em que ela foi enviada. Sem exclusão de lote.
REVOKE ALL ON "orc_lote_viagem" FROM sgo_sync;
REVOKE UPDATE, DELETE ON "orc_lote_viagem" FROM sgo_app;
GRANT UPDATE ("situacao", "versao") ON "orc_lote_viagem" TO sgo_app;
GRANT UPDATE ("lote_viagem_id") ON "orc_viagem" TO sgo_app;
