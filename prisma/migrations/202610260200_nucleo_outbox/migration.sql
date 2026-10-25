-- CreateTable
CREATE TABLE "outbox_mensagem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tipo" TEXT NOT NULL,
    "dados" JSONB NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "publicado_em" TIMESTAMPTZ(6),
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "ultimo_erro" TEXT,

    CONSTRAINT "outbox_mensagem_pkey" PRIMARY KEY ("id")
);

-- Só as pendentes são lidas pelo publicador: índice parcial.
CREATE INDEX "outbox_mensagem_pendentes_idx" ON "outbox_mensagem" ("criado_em") WHERE "publicado_em" IS NULL;
