-- Metas da proposta de TP (US-067; plano do P19, Task 1). SQL à mão, no formato que o Prisma gera para
-- o schema (orc.prisma), conferido pelos testes de integração. Nenhuma tabela da frente B é tocada.

-- 1) A meta é da versão da proposta (D-P19-1): cada versão tem as suas, e a nova versão e a duplicação
--    as copiam (RN_DUP_003). Tipo e proposta vêm da capa (D-P19-3); o valor é planejamento, em
--    NUMERIC(15,2), e o total das metas é sempre calculado (RN0149).
-- CreateTable
CREATE TABLE "orc_meta" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "unidade_id" UUID NOT NULL,
    "versao_proposta_id" UUID NOT NULL,
    "numero" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "valor" DECIMAL(15,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ATIVO',
    "observacao" TEXT,
    "criado_por" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "versao" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "orc_meta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orc_meta_unidade_id_idx" ON "orc_meta"("unidade_id");

-- CreateIndex
CREATE INDEX "orc_meta_versao_proposta_id_idx" ON "orc_meta"("versao_proposta_id");

-- AddForeignKey
ALTER TABLE "orc_meta" ADD CONSTRAINT "orc_meta_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_meta" ADD CONSTRAINT "orc_meta_versao_proposta_id_fkey" FOREIGN KEY ("versao_proposta_id") REFERENCES "orc_versao_proposta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- O número é único na versão sem diferença de maiúsculas: M1 e m1 seriam a mesma meta (D-P19-3). O
-- Prisma não declara índice de expressão; na corrida, quem perde recebe a violação deste índice.
CREATE UNIQUE INDEX "orc_meta_versao_numero_key" ON "orc_meta" ("versao_proposta_id", upper("numero"));

-- 2) Regras da meta (UC03.15, RN0106, D-P19-3). Os limites espelham o domain/meta.ts.
ALTER TABLE "orc_meta"
  ADD CONSTRAINT "orc_meta_numero_check" CHECK (char_length(btrim("numero")) BETWEEN 1 AND 20),
  ADD CONSTRAINT "orc_meta_nome_check" CHECK (char_length(btrim("nome")) BETWEEN 1 AND 200),
  ADD CONSTRAINT "orc_meta_valor_check" CHECK ("valor" >= 0),
  ADD CONSTRAINT "orc_meta_status_check" CHECK ("status" IN ('ATIVO', 'INATIVO')),
  ADD CONSTRAINT "orc_meta_observacao_check" CHECK ("observacao" IS NULL OR char_length(btrim("observacao")) BETWEEN 1 AND 1000),
  ADD CONSTRAINT "orc_meta_versao_check" CHECK ("versao" >= 0);

-- A meta é da mesma unidade da versão: a RLS de uma vale para a outra (como a versão e a capa, P17).
CREATE FUNCTION orc_meta_mesma_unidade() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "orc_versao_proposta" v WHERE v.id = NEW.versao_proposta_id AND v.unidade_id = NEW.unidade_id) THEN
    RAISE EXCEPTION 'orc.meta_outra_unidade' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER orc_meta_mesma_unidade BEFORE INSERT OR UPDATE OF "unidade_id", "versao_proposta_id" ON "orc_meta"
  FOR EACH ROW EXECUTE FUNCTION orc_meta_mesma_unidade();
REVOKE EXECUTE ON FUNCTION orc_meta_mesma_unidade() FROM PUBLIC;

-- 3) RLS por unidade (US-007): a política padrão.
ALTER TABLE "orc_meta" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orc_meta_unidade" ON "orc_meta"
  USING (unidade_id = ANY ((SELECT app_unidades())::uuid[])) WITH CHECK (unidade_id = ANY ((SELECT app_unidades())::uuid[]));

-- 4) Privilégios (spec §11.5). O sincronismo do ERP não toca na meta. A aplicação insere, lê e apaga
--    (a exclusão é física, UC03.17, D-P19-6); o número, a versão da proposta e a unidade não mudam.
REVOKE ALL ON "orc_meta" FROM sgo_sync;
REVOKE UPDATE ON "orc_meta" FROM sgo_app;
GRANT UPDATE ("nome", "valor", "status", "observacao", "versao") ON "orc_meta" TO sgo_app;
