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
    "iniciado_em" TIMESTAMPTZ(6),
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

-- Uma conclusão só, para qualquer papel (como orc_revisao): a linha só muda enquanto está PENDENTE;
-- caso, pessoa e data do pedido não mudam; e o worker toma a avaliação uma vez (iniciado_em não volta).
CREATE FUNCTION ia_avaliacao_uma_conclusao() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD."situacao" <> 'PENDENTE' THEN
    RAISE EXCEPTION 'ia_avaliacao já concluída';
  END IF;
  IF NEW."caso_uso_codigo" <> OLD."caso_uso_codigo" OR NEW."usuario_id" <> OLD."usuario_id" OR NEW."criado_em" <> OLD."criado_em" THEN
    RAISE EXCEPTION 'ia_avaliacao: o pedido não muda';
  END IF;
  IF OLD."iniciado_em" IS NOT NULL AND NEW."iniciado_em" IS DISTINCT FROM OLD."iniciado_em" THEN
    RAISE EXCEPTION 'ia_avaliacao já iniciada';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ia_avaliacao_uma_conclusao
  BEFORE UPDATE ON "ia_avaliacao"
  FOR EACH ROW EXECUTE FUNCTION ia_avaliacao_uma_conclusao();

-- Privilégios: a tela cria o pedido; o worker toma e grava o resultado (o trigger limita as transições).
-- Ninguém apaga (é o histórico das avaliações). O avaliavel do caso vem da seed (migrator). Sem FK para
-- usuario: o Prisma não declara relação com o adm (como em exportacao_pedido).
REVOKE ALL ON "ia_avaliacao" FROM sgo_app, sgo_sync;
GRANT SELECT ON "ia_avaliacao" TO sgo_app;
GRANT INSERT ("caso_uso_codigo", "usuario_id") ON "ia_avaliacao" TO sgo_app;
GRANT UPDATE ("situacao", "total", "acertos", "resumo", "erro", "iniciado_em", "concluido_em") ON "ia_avaliacao" TO sgo_app;
