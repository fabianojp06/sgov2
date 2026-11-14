-- Lote de pessoal da versão para homologação (US-080; plano do P27, Task 1). SQL à mão, no formato que o Prisma
-- gera para o schema (orc.prisma), conferido pelos testes de integração. Nenhuma tabela da frente B é tocada.

-- O lote de pessoal da versão (UC6.01; D-P27-3 a D-P27-6): sem linha, Em Elaboração. A finalização o leva a Em
-- Aprovação; a homologação, a Homologado; a rejeição o devolve a Em Elaboração.
-- CreateTable
CREATE TABLE "orc_lote_pessoal" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "unidade_id" UUID NOT NULL,
    "versao_proposta_id" UUID NOT NULL,
    "situacao" TEXT NOT NULL DEFAULT 'EM_ELABORACAO',
    "finalizado_por" UUID,
    "versao" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "orc_lote_pessoal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orc_lote_pessoal_versao_proposta_id_key" ON "orc_lote_pessoal"("versao_proposta_id");

-- CreateIndex
CREATE INDEX "orc_lote_pessoal_unidade_id_idx" ON "orc_lote_pessoal"("unidade_id");

-- AddForeignKey
ALTER TABLE "orc_lote_pessoal" ADD CONSTRAINT "orc_lote_pessoal_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_lote_pessoal" ADD CONSTRAINT "orc_lote_pessoal_versao_proposta_id_fkey" FOREIGN KEY ("versao_proposta_id") REFERENCES "orc_versao_proposta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "orc_lote_pessoal"
  ADD CONSTRAINT "orc_lote_pessoal_situacao_check" CHECK ("situacao" IN ('EM_ELABORACAO', 'EM_APROVACAO', 'HOMOLOGADO')),
  ADD CONSTRAINT "orc_lote_pessoal_versao_check" CHECK ("versao" >= 0);

CREATE TRIGGER orc_lote_pessoal_mesma_unidade BEFORE INSERT OR UPDATE OF "unidade_id", "versao_proposta_id" ON "orc_lote_pessoal"
  FOR EACH ROW EXECUTE FUNCTION orc_teto_viagem_mesma_unidade();

ALTER TABLE "orc_lote_pessoal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orc_lote_pessoal_unidade" ON "orc_lote_pessoal"
  USING (unidade_id = ANY ((SELECT app_unidades())::uuid[])) WITH CHECK (unidade_id = ANY ((SELECT app_unidades())::uuid[]));

-- Privilégios (spec §11.5): a aplicação insere, lê e muda só a situação, quem finalizou e a versão. Sem exclusão.
REVOKE ALL ON "orc_lote_pessoal" FROM sgo_sync;
REVOKE UPDATE, DELETE ON "orc_lote_pessoal" FROM sgo_app;
GRANT UPDATE ("situacao", "finalizado_por", "versao") ON "orc_lote_pessoal" TO sgo_app;
