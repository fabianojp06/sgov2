-- Solicitação de aprovação (US-078; plano do P26, Task 1). SQL à mão, no formato que o Prisma gera para o
-- schema (apr.prisma), conferido pelos testes de integração. Nenhuma tabela da frente B é tocada.

-- 1) O pedido de um fluxo sobre um alvo, roteado pela alçada a um aprovador fixo (D-P26-5, RN_ALC_005).
-- CreateTable
CREATE TABLE "apr_solicitacao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "unidade_id" UUID NOT NULL,
    "fluxo" TEXT NOT NULL,
    "alvo_tipo" TEXT NOT NULL,
    "alvo_id" UUID NOT NULL,
    "descricao" TEXT NOT NULL,
    "solicitante_id" UUID NOT NULL,
    "aprovador_id" UUID NOT NULL,
    "papel_aprovador" TEXT NOT NULL,
    "situacao" TEXT NOT NULL DEFAULT 'EM_APROVACAO',
    "justificativa" TEXT,
    "enviada_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "decidida_em" TIMESTAMPTZ(6),
    "versao" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "apr_solicitacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "apr_solicitacao_unidade_id_idx" ON "apr_solicitacao"("unidade_id");

-- CreateIndex
CREATE INDEX "apr_solicitacao_aprovador_id_idx" ON "apr_solicitacao"("aprovador_id");

-- CreateIndex
CREATE INDEX "apr_solicitacao_alvo_id_idx" ON "apr_solicitacao"("alvo_id");

-- AddForeignKey
ALTER TABLE "apr_solicitacao" ADD CONSTRAINT "apr_solicitacao_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apr_solicitacao" ADD CONSTRAINT "apr_solicitacao_solicitante_id_fkey" FOREIGN KEY ("solicitante_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apr_solicitacao" ADD CONSTRAINT "apr_solicitacao_aprovador_id_fkey" FOREIGN KEY ("aprovador_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2) Regras (RN_WA01_006, RN_WA01_009, RN_WA02_006). O Prisma não declara o índice parcial: uma só solicitação
--    EM_APROVACAO por alvo; na corrida, quem perde recebe a violação dele.
ALTER TABLE "apr_solicitacao"
  ADD CONSTRAINT "apr_solicitacao_fluxo_check" CHECK ("fluxo" IN ('WA01', 'WA02', 'WA05')),
  ADD CONSTRAINT "apr_solicitacao_papel_check" CHECK ("papel_aprovador" IN ('TITULAR', 'SUBSTITUTO')),
  ADD CONSTRAINT "apr_solicitacao_situacao_check" CHECK ("situacao" IN ('EM_APROVACAO', 'APROVADO', 'REJEITADO')),
  ADD CONSTRAINT "apr_solicitacao_decisao_check" CHECK (("situacao" = 'EM_APROVACAO') = ("decidida_em" IS NULL)),
  ADD CONSTRAINT "apr_solicitacao_justificativa_check" CHECK ("situacao" <> 'REJEITADO' OR char_length(btrim("justificativa")) >= 15),
  ADD CONSTRAINT "apr_solicitacao_mesmo_usuario_check" CHECK ("aprovador_id" <> "solicitante_id"),
  ADD CONSTRAINT "apr_solicitacao_descricao_check" CHECK (char_length(btrim("descricao")) BETWEEN 1 AND 300),
  ADD CONSTRAINT "apr_solicitacao_versao_check" CHECK ("versao" >= 0);

CREATE UNIQUE INDEX "apr_solicitacao_alvo_pendente_key" ON "apr_solicitacao" ("alvo_id") WHERE "situacao" = 'EM_APROVACAO';

-- 3) RLS por unidade (US-007): a política padrão. O aprovador roteado é vinculado à unidade no envio (D-P26-4).
ALTER TABLE "apr_solicitacao" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "apr_solicitacao_unidade" ON "apr_solicitacao"
  USING (unidade_id = ANY ((SELECT app_unidades())::uuid[])) WITH CHECK (unidade_id = ANY ((SELECT app_unidades())::uuid[]));

-- 4) Privilégios (spec §11.5). O sincronismo do ERP não toca nas aprovações. A aplicação insere e lê; a decisão
--    muda só a situação, a justificativa, a data e a versão. Não há exclusão: o pedido é histórico.
REVOKE ALL ON "apr_solicitacao" FROM sgo_sync;
REVOKE UPDATE, DELETE ON "apr_solicitacao" FROM sgo_app;
GRANT UPDATE ("situacao", "justificativa", "decidida_em", "versao") ON "apr_solicitacao" TO sgo_app;
