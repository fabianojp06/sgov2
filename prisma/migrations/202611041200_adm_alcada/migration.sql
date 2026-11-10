-- US-042 (spec §6.5 e §11.4): alçada de aprovação por fluxo, com titular e substituto ativos e
-- diferentes. Soft delete: trocar um aprovador ou excluir inativa a linha (preserva quem aprovava em
-- cada período); uma só alçada ativa por fluxo.
-- CreateTable
CREATE TABLE "adm_alcada_aprovacao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fluxo" TEXT NOT NULL,
    "titular_id" UUID NOT NULL,
    "substituto_id" UUID NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "inativada_em" TIMESTAMPTZ(6),
    "criada_em" TIMESTAMPTZ(6) NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "adm_alcada_aprovacao_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "adm_alcada_aprovacao_fluxo_check" CHECK ("fluxo" IN ('WA01', 'WA02', 'WA05')),
    CONSTRAINT "adm_alcada_aprovacao_aprovadores_check" CHECK ("titular_id" <> "substituto_id"),
    CONSTRAINT "adm_alcada_aprovacao_inativacao_check" CHECK ("ativa" = ("inativada_em" IS NULL))
);

-- CreateIndex
CREATE UNIQUE INDEX "adm_alcada_aprovacao_fluxo_ativa_key" ON "adm_alcada_aprovacao"("fluxo") WHERE "ativa";

-- CreateIndex
CREATE INDEX "adm_alcada_aprovacao_titular_id_idx" ON "adm_alcada_aprovacao"("titular_id");

-- CreateIndex
CREATE INDEX "adm_alcada_aprovacao_substituto_id_idx" ON "adm_alcada_aprovacao"("substituto_id");

-- AddForeignKey
ALTER TABLE "adm_alcada_aprovacao" ADD CONSTRAINT "adm_alcada_aprovacao_titular_id_fkey" FOREIGN KEY ("titular_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adm_alcada_aprovacao" ADD CONSTRAINT "adm_alcada_aprovacao_substituto_id_fkey" FOREIGN KEY ("substituto_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Privilégios (spec §11.5): soft delete, sem DELETE; a aplicação só altera a inativação e a versão.
REVOKE ALL ON "adm_alcada_aprovacao" FROM sgo_sync;
REVOKE UPDATE, DELETE, TRUNCATE ON "adm_alcada_aprovacao" FROM sgo_app;
GRANT UPDATE ("ativa", "inativada_em", "versao") ON "adm_alcada_aprovacao" TO sgo_app;
