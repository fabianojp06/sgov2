-- CreateTable
CREATE TABLE "sinal_vida" (
    "componente" TEXT NOT NULL,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "sinal_vida_pkey" PRIMARY KEY ("componente")
);


-- Regras que o Prisma não expressa (US-017).
ALTER TABLE "sinal_vida" ADD CONSTRAINT "sinal_vida_componente_check" CHECK ("componente" IN ('worker'));
-- O app (worker e endpoint de saúde, ambos com o sgo_app) lê e grava só o próprio sinal; nada de apagar.
REVOKE ALL ON "sinal_vida" FROM sgo_app, sgo_sync;
GRANT SELECT, INSERT ON "sinal_vida" TO sgo_app;
GRANT UPDATE ("atualizado_em") ON "sinal_vida" TO sgo_app;
