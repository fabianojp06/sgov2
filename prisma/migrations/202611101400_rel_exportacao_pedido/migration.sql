-- CreateEnum
CREATE TYPE "SituacaoExportacao" AS ENUM ('PENDENTE', 'PRONTA', 'FALHOU');

-- CreateTable
CREATE TABLE "exportacao_pedido" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "usuario_rotulo" TEXT NOT NULL,
    "sessao_uid" TEXT NOT NULL,
    "ip" TEXT,
    "funcionalidade" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "formato" TEXT NOT NULL,
    "parametros" JSONB NOT NULL,
    "situacao" "SituacaoExportacao" NOT NULL DEFAULT 'PENDENTE',
    "registros" INTEGER,
    "nome_arquivo" TEXT,
    "conteudo" BYTEA,
    "erro" TEXT,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "concluido_em" TIMESTAMPTZ(6),

    CONSTRAINT "exportacao_pedido_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exportacao_pedido_usuario_id_criado_em_idx" ON "exportacao_pedido"("usuario_id", "criado_em");


-- Regras que o schema do Prisma não expressa (US-024).
ALTER TABLE "exportacao_pedido" ADD CONSTRAINT "exportacao_pedido_formato_check" CHECK ("formato" IN ('xlsx', 'csv'));
-- Pronta tem o arquivo; falha tem o motivo; pendente não tem nenhum dos dois.
ALTER TABLE "exportacao_pedido" ADD CONSTRAINT "exportacao_pedido_situacao_check" CHECK (
  CASE "situacao"
    WHEN 'PRONTA' THEN "conteudo" IS NOT NULL AND "nome_arquivo" IS NOT NULL AND "registros" IS NOT NULL AND "concluido_em" IS NOT NULL AND "erro" IS NULL
    WHEN 'FALHOU' THEN "conteudo" IS NULL AND "erro" IS NOT NULL AND "concluido_em" IS NOT NULL
    ELSE "conteudo" IS NULL AND "erro" IS NULL AND "concluido_em" IS NULL
  END
);

-- Privilégios: o app (tela e worker) cria o pedido, lê e grava só o resultado da geração; apaga para
-- a limpeza dos vencidos. O sgo_sync não toca.
REVOKE ALL ON "exportacao_pedido" FROM sgo_app, sgo_sync;
GRANT SELECT, INSERT, DELETE ON "exportacao_pedido" TO sgo_app;
GRANT UPDATE ("situacao", "registros", "nome_arquivo", "conteudo", "erro", "concluido_em") ON "exportacao_pedido" TO sgo_app;
