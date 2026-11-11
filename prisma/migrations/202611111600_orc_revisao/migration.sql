-- Revisor de consistência antes do envio para aprovação (US-064; plano do P14, Task 3 e D-P14-6).
-- SQL à mão, conferido pelos testes de integração (que aplicam as migrations num banco descartável).
-- A tela grava a revisão PENDENTE e a mensagem do outbox na mesma transação; o worker grava os
-- achados e a conclusão. A revisão sai de PENDENTE uma vez só.

-- CreateTable
CREATE TABLE "orc_revisao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "exercicio_id" UUID NOT NULL,
    "versao_exercicio" INTEGER NOT NULL,
    "situacao" TEXT NOT NULL DEFAULT 'PENDENTE',
    "achados" JSONB NOT NULL DEFAULT '[]',
    "avisos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "solicitado_por" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "concluido_em" TIMESTAMPTZ(6),

    CONSTRAINT "orc_revisao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orc_revisao_exercicio_id_criado_em_idx" ON "orc_revisao"("exercicio_id", "criado_em" DESC);

-- AddForeignKey
ALTER TABLE "orc_revisao" ADD CONSTRAINT "orc_revisao_exercicio_id_fkey" FOREIGN KEY ("exercicio_id") REFERENCES "orc_exercicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_revisao" ADD CONSTRAINT "orc_revisao_solicitado_por_fkey" FOREIGN KEY ("solicitado_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Situações e coerência da conclusão: PENDENTE sem data de conclusão; CONCLUIDA e FALHOU com ela.
ALTER TABLE "orc_revisao"
  ADD CONSTRAINT "orc_revisao_situacao_check" CHECK ("situacao" IN ('PENDENTE', 'CONCLUIDA', 'FALHOU')),
  ADD CONSTRAINT "orc_revisao_conclusao_check" CHECK (("situacao" = 'PENDENTE') = ("concluido_em" IS NULL)),
  ADD CONSTRAINT "orc_revisao_achados_check" CHECK (jsonb_typeof("achados") = 'array'),
  ADD CONSTRAINT "orc_revisao_avisos_check" CHECK ("avisos" IS NOT NULL),
  ADD CONSTRAINT "orc_revisao_versao_check" CHECK ("versao_exercicio" >= 0);

-- A revisão concluída (ou que falhou) não muda mais: uma nova tentativa do worker não a reescreve.
CREATE FUNCTION orc_revisao_uma_conclusao() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.situacao <> 'PENDENTE' THEN
    RAISE EXCEPTION 'orc.revisao_concluida' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER orc_revisao_uma_conclusao BEFORE UPDATE ON "orc_revisao"
  FOR EACH ROW EXECUTE FUNCTION orc_revisao_uma_conclusao();

-- Privilégios: o app (tela e worker) lê, pede (só o exercício, a versão e quem pede; o resto vem do
-- padrão) e conclui (só a situação, os achados, os avisos e a data). Sem DELETE. O sgo_sync não toca.
REVOKE ALL ON "orc_revisao" FROM sgo_app, sgo_sync;
GRANT SELECT ON "orc_revisao" TO sgo_app;
GRANT INSERT ("exercicio_id", "versao_exercicio", "solicitado_por") ON "orc_revisao" TO sgo_app;
GRANT UPDATE ("situacao", "achados", "avisos", "concluido_em") ON "orc_revisao" TO sgo_app;
REVOKE EXECUTE ON FUNCTION orc_revisao_uma_conclusao() FROM PUBLIC;
