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

ALTER TABLE "orc_lote_viagem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orc_lote_viagem_unidade" ON "orc_lote_viagem"
  USING (unidade_id = ANY ((SELECT app_unidades())::uuid[])) WITH CHECK (unidade_id = ANY ((SELECT app_unidades())::uuid[]));

-- Privilégios (spec §11.5): a aplicação insere, lê e muda só a situação e a versão do lote; na viagem, também o
-- lote em que ela foi enviada. Sem exclusão de lote.
REVOKE ALL ON "orc_lote_viagem" FROM sgo_sync;
REVOKE UPDATE, DELETE ON "orc_lote_viagem" FROM sgo_app;
GRANT UPDATE ("situacao", "versao") ON "orc_lote_viagem" TO sgo_app;
GRANT UPDATE ("lote_viagem_id") ON "orc_viagem" TO sgo_app;
