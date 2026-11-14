-- Realizado por arquivo (US-085, parte 1; plano do P32, Task 1; OxR V2, seção 7). SQL à mão, no formato que o Prisma
-- gera para o schema (orc.prisma), conferido pelos testes de integração. Nenhuma tabela da frente B é tocada.

-- CreateTable
CREATE TABLE "orc_realizado_carga" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "unidade_id" UUID NOT NULL,
    "arquivo" TEXT NOT NULL,
    "linhas" INTEGER NOT NULL,
    "total" DECIMAL(15,2) NOT NULL,
    "pendencias" INTEGER NOT NULL,
    "ajustes" INTEGER NOT NULL,
    "competencias" TEXT[],
    "carregado_por" UUID NOT NULL,
    "carregado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "orc_realizado_carga_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orc_realizado" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "unidade_id" UUID NOT NULL,
    "conta" TEXT NOT NULL,
    "competencia" DATE NOT NULL,
    "valor" DECIMAL(15,2) NOT NULL,
    "carga_id" UUID NOT NULL,

    CONSTRAINT "orc_realizado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orc_realizado_ajuste" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "unidade_id" UUID NOT NULL,
    "conta" TEXT NOT NULL,
    "competencia_origem" DATE NOT NULL,
    "competencia_lancamento" DATE NOT NULL,
    "valor" DECIMAL(15,2) NOT NULL,
    "carga_id" UUID NOT NULL,

    CONSTRAINT "orc_realizado_ajuste_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orc_realizado_pendencia" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "unidade_id" UUID NOT NULL,
    "conta_erp" TEXT NOT NULL,
    "competencia" DATE NOT NULL,
    "valor" DECIMAL(15,2) NOT NULL,
    "motivo" TEXT NOT NULL,
    "carga_id" UUID NOT NULL,

    CONSTRAINT "orc_realizado_pendencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orc_competencia_fechada" (
    "competencia" DATE NOT NULL,
    "fechada_por" UUID NOT NULL,
    "fechada_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "orc_competencia_fechada_pkey" PRIMARY KEY ("competencia")
);

-- CreateIndex
CREATE INDEX "orc_realizado_carga_unidade_id_carregado_em_idx" ON "orc_realizado_carga"("unidade_id", "carregado_em");

-- CreateIndex
CREATE INDEX "orc_realizado_carga_id_idx" ON "orc_realizado"("carga_id");

-- CreateIndex
CREATE UNIQUE INDEX "orc_realizado_unidade_id_conta_competencia_key" ON "orc_realizado"("unidade_id", "conta", "competencia");

-- CreateIndex
CREATE INDEX "orc_realizado_ajuste_unidade_id_conta_competencia_origem_idx" ON "orc_realizado_ajuste"("unidade_id", "conta", "competencia_origem");

-- CreateIndex
CREATE INDEX "orc_realizado_ajuste_carga_id_idx" ON "orc_realizado_ajuste"("carga_id");

-- CreateIndex
CREATE INDEX "orc_realizado_pendencia_unidade_id_competencia_idx" ON "orc_realizado_pendencia"("unidade_id", "competencia");

-- CreateIndex
CREATE INDEX "orc_realizado_pendencia_carga_id_idx" ON "orc_realizado_pendencia"("carga_id");

-- AddForeignKey
ALTER TABLE "orc_realizado_carga" ADD CONSTRAINT "orc_realizado_carga_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_realizado" ADD CONSTRAINT "orc_realizado_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_realizado" ADD CONSTRAINT "orc_realizado_carga_id_fkey" FOREIGN KEY ("carga_id") REFERENCES "orc_realizado_carga"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_realizado_ajuste" ADD CONSTRAINT "orc_realizado_ajuste_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_realizado_ajuste" ADD CONSTRAINT "orc_realizado_ajuste_carga_id_fkey" FOREIGN KEY ("carga_id") REFERENCES "orc_realizado_carga"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_realizado_pendencia" ADD CONSTRAINT "orc_realizado_pendencia_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_realizado_pendencia" ADD CONSTRAINT "orc_realizado_pendencia_carga_id_fkey" FOREIGN KEY ("carga_id") REFERENCES "orc_realizado_carga"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Competência sempre no dia 1; contagens e motivos fechados.
ALTER TABLE "orc_realizado_carga"
  ADD CONSTRAINT "orc_realizado_carga_contagens_check" CHECK ("linhas" >= 0 AND "pendencias" >= 0 AND "ajustes" >= 0);
ALTER TABLE "orc_realizado"
  ADD CONSTRAINT "orc_realizado_competencia_check" CHECK (EXTRACT(DAY FROM "competencia") = 1);
ALTER TABLE "orc_realizado_ajuste"
  ADD CONSTRAINT "orc_realizado_ajuste_competencias_check" CHECK (
    EXTRACT(DAY FROM "competencia_origem") = 1 AND EXTRACT(DAY FROM "competencia_lancamento") = 1 AND "competencia_lancamento" > "competencia_origem"
  ),
  ADD CONSTRAINT "orc_realizado_ajuste_valor_check" CHECK ("valor" <> 0);
ALTER TABLE "orc_realizado_pendencia"
  ADD CONSTRAINT "orc_realizado_pendencia_competencia_check" CHECK (EXTRACT(DAY FROM "competencia") = 1),
  ADD CONSTRAINT "orc_realizado_pendencia_motivo_check" CHECK ("motivo" IN ('CONTA_DESCONHECIDA', 'CONTA_SINTETICA'));
ALTER TABLE "orc_competencia_fechada"
  ADD CONSTRAINT "orc_competencia_fechada_competencia_check" CHECK (EXTRACT(DAY FROM "competencia") = 1);

-- RLS por unidade (o fechamento da competência é global, sem RLS: vale para todos os TPs, D-P32-4).
ALTER TABLE "orc_realizado_carga" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orc_realizado_carga_unidade" ON "orc_realizado_carga"
  USING (unidade_id = ANY ((SELECT app_unidades())::uuid[])) WITH CHECK (unidade_id = ANY ((SELECT app_unidades())::uuid[]));
ALTER TABLE "orc_realizado" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orc_realizado_unidade" ON "orc_realizado"
  USING (unidade_id = ANY ((SELECT app_unidades())::uuid[])) WITH CHECK (unidade_id = ANY ((SELECT app_unidades())::uuid[]));
ALTER TABLE "orc_realizado_ajuste" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orc_realizado_ajuste_unidade" ON "orc_realizado_ajuste"
  USING (unidade_id = ANY ((SELECT app_unidades())::uuid[])) WITH CHECK (unidade_id = ANY ((SELECT app_unidades())::uuid[]));
ALTER TABLE "orc_realizado_pendencia" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orc_realizado_pendencia_unidade" ON "orc_realizado_pendencia"
  USING (unidade_id = ANY ((SELECT app_unidades())::uuid[])) WITH CHECK (unidade_id = ANY ((SELECT app_unidades())::uuid[]));

-- Privilégios (spec §11.5): a carga e o ajuste são só inserção (rastro); o realizado do mês aberto e as pendências
-- são apagados e regravados pela carga seguinte (RN_OXR_005, D-P32-3), nunca alterados; a competência fechada não
-- reabre (D-P32-4). O sgo_sync não toca nada.
REVOKE ALL ON "orc_realizado_carga", "orc_realizado", "orc_realizado_ajuste", "orc_realizado_pendencia", "orc_competencia_fechada" FROM sgo_sync;
REVOKE UPDATE, DELETE ON "orc_realizado_carga", "orc_realizado_ajuste", "orc_competencia_fechada" FROM sgo_app;
REVOKE UPDATE ON "orc_realizado", "orc_realizado_pendencia" FROM sgo_app;
