-- CreateEnum
CREATE TYPE "SituacaoRelatorioExecutivo" AS ENUM ('RASCUNHO', 'APROVADO');

-- CreateTable
CREATE TABLE "rel_relatorio_executivo" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mes" TEXT NOT NULL,
    "situacao" "SituacaoRelatorioExecutivo" NOT NULL DEFAULT 'RASCUNHO',
    "dados" JSONB NOT NULL,
    "resumo" TEXT NOT NULL,
    "riscos" JSONB NOT NULL,
    "recomendacoes" JSONB NOT NULL,
    "gerado_por" UUID NOT NULL,
    "gerado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "aprovado_por" UUID,
    "aprovado_rotulo" TEXT,
    "aprovado_em" TIMESTAMPTZ(6),
    "versao" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "rel_relatorio_executivo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rel_relatorio_executivo_mes_key" ON "rel_relatorio_executivo"("mes");


-- Regras que o schema do Prisma não expressa (US-103).
ALTER TABLE "rel_relatorio_executivo" ADD CONSTRAINT "rel_relatorio_executivo_mes_check" CHECK ("mes" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "rel_relatorio_executivo" ADD CONSTRAINT "rel_relatorio_executivo_aprovacao_check" CHECK (
  CASE "situacao"
    WHEN 'APROVADO' THEN "aprovado_por" IS NOT NULL AND "aprovado_rotulo" IS NOT NULL AND "aprovado_em" IS NOT NULL
    ELSE "aprovado_por" IS NULL AND "aprovado_rotulo" IS NULL AND "aprovado_em" IS NULL
  END
);
ALTER TABLE "rel_relatorio_executivo" ADD CONSTRAINT "rel_relatorio_executivo_listas_check" CHECK (jsonb_typeof("riscos") = 'array' AND jsonb_typeof("recomendacoes") = 'array');

-- Aprovado não muda mais (o PDF distribuído é o aprovado).
CREATE FUNCTION "rel_relatorio_executivo_imutavel"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."situacao" = 'APROVADO' THEN
    RAISE EXCEPTION 'Relatório executivo aprovado não pode ser alterado' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "rel_relatorio_executivo_imutavel" BEFORE UPDATE OR DELETE ON "rel_relatorio_executivo"
  FOR EACH ROW EXECUTE FUNCTION "rel_relatorio_executivo_imutavel"();

-- Privilégios: o app gera (insere), regera e edita o rascunho e aprova (só as colunas de conteúdo e de
-- aprovação); não apaga. O sgo_sync não toca.
REVOKE ALL ON "rel_relatorio_executivo" FROM sgo_app, sgo_sync;
GRANT SELECT, INSERT ON "rel_relatorio_executivo" TO sgo_app;
GRANT UPDATE ("situacao", "dados", "resumo", "riscos", "recomendacoes", "gerado_por", "gerado_em", "aprovado_por", "aprovado_rotulo", "aprovado_em", "versao")
  ON "rel_relatorio_executivo" TO sgo_app;
