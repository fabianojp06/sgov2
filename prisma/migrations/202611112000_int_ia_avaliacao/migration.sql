-- CreateEnum
CREATE TYPE "SituacaoAvaliacaoIA" AS ENUM ('PENDENTE', 'CONCLUIDA', 'FALHOU');

-- AlterTable
ALTER TABLE "ia_caso_uso" ADD COLUMN     "avaliavel" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ia_avaliacao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "caso_uso_codigo" TEXT NOT NULL,
    "usuario_id" UUID NOT NULL,
    "situacao" "SituacaoAvaliacaoIA" NOT NULL DEFAULT 'PENDENTE',
    "total" INTEGER,
    "acertos" INTEGER,
    "resumo" JSONB,
    "erro" TEXT,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "concluido_em" TIMESTAMPTZ(6),

    CONSTRAINT "ia_avaliacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ia_avaliacao_caso_uso_codigo_criado_em_idx" ON "ia_avaliacao"("caso_uso_codigo", "criado_em");

-- AddForeignKey
ALTER TABLE "ia_avaliacao" ADD CONSTRAINT "ia_avaliacao_caso_uso_codigo_fkey" FOREIGN KEY ("caso_uso_codigo") REFERENCES "ia_caso_uso"("codigo") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Regras que o Prisma não expressa (US-019, avaliação; pedido da frente A na #138).
-- Pendente não tem resultado; concluída tem total e acertos (0 ≤ acertos ≤ total); falha tem o motivo.
ALTER TABLE "ia_avaliacao" ADD CONSTRAINT "ia_avaliacao_situacao_check" CHECK (
  CASE "situacao"
    WHEN 'CONCLUIDA' THEN "total" IS NOT NULL AND "acertos" IS NOT NULL AND "acertos" BETWEEN 0 AND "total" AND "erro" IS NULL AND "concluido_em" IS NOT NULL
    WHEN 'FALHOU' THEN "erro" IS NOT NULL AND "concluido_em" IS NOT NULL
    ELSE "total" IS NULL AND "acertos" IS NULL AND "erro" IS NULL AND "concluido_em" IS NULL
  END
);
-- Uma avaliação pendente por caso de uso de cada vez.
CREATE UNIQUE INDEX "ia_avaliacao_pendente_key" ON "ia_avaliacao" ("caso_uso_codigo") WHERE "situacao" = 'PENDENTE';

-- Privilégios: a tela cria o pedido; o worker grava só o resultado. Ninguém apaga (é o histórico das
-- avaliações). O avaliavel do caso vem da seed (migrator), como o resto do que vem do código.
REVOKE ALL ON "ia_avaliacao" FROM sgo_app, sgo_sync;
GRANT SELECT ON "ia_avaliacao" TO sgo_app;
GRANT INSERT ("caso_uso_codigo", "usuario_id") ON "ia_avaliacao" TO sgo_app;
GRANT UPDATE ("situacao", "total", "acertos", "resumo", "erro", "concluido_em") ON "ia_avaliacao" TO sgo_app;
