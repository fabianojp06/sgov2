-- Pessoal da proposta de TP (US-070; plano do P20, Task 1). SQL à mão, no formato que o Prisma gera para
-- o schema (orc.prisma), conferido pelos testes de integração. Nenhuma tabela da frente B é tocada.

-- 1) Empregado (headcount) da versão da proposta (D-P20-2): meta obrigatória na categoria Meta (no caso
--    de uso) e com FK RESTRICT, que fecha a RN0136 (D-P19-6). Nome nulo é a vaga "A CONTRATAR" (RN0249).
--    O cargo é do cadastro de C&S, sem FK (como a posição, P15); o salário é a Fonte Ativa herdada ao salvar.
-- CreateTable
CREATE TABLE "orc_empregado" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "unidade_id" UUID NOT NULL,
    "versao_proposta_id" UUID NOT NULL,
    "meta_id" UUID,
    "ordem" INTEGER NOT NULL,
    "categoria" TEXT NOT NULL,
    "nome" TEXT,
    "cargo_id" UUID NOT NULL,
    "salario_mensal" DECIMAL(15,2) NOT NULL,
    "inicio" DATE NOT NULL,
    "fim" DATE NOT NULL,
    "dependentes" INTEGER NOT NULL DEFAULT 0,
    "criado_por" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "versao" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "orc_empregado_pkey" PRIMARY KEY ("id")
);

-- 2) Quantitativo por período (D-P20-6): só o período e o documento são digitados; as quantidades são
--    contadas dos empregados (RN0457).
-- CreateTable
CREATE TABLE "orc_qtde_empregado" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "unidade_id" UUID NOT NULL,
    "versao_proposta_id" UUID NOT NULL,
    "meta_id" UUID,
    "inicio" DATE NOT NULL,
    "fim" DATE NOT NULL,
    "documento" TEXT NOT NULL,
    "criado_por" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "versao" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "orc_qtde_empregado_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orc_empregado_unidade_id_idx" ON "orc_empregado"("unidade_id");

-- CreateIndex
CREATE INDEX "orc_empregado_versao_proposta_id_idx" ON "orc_empregado"("versao_proposta_id");

-- CreateIndex
CREATE INDEX "orc_empregado_meta_id_idx" ON "orc_empregado"("meta_id");

-- CreateIndex
CREATE INDEX "orc_qtde_empregado_unidade_id_idx" ON "orc_qtde_empregado"("unidade_id");

-- CreateIndex
CREATE INDEX "orc_qtde_empregado_versao_proposta_id_idx" ON "orc_qtde_empregado"("versao_proposta_id");

-- CreateIndex
CREATE INDEX "orc_qtde_empregado_meta_id_idx" ON "orc_qtde_empregado"("meta_id");

-- AddForeignKey
ALTER TABLE "orc_empregado" ADD CONSTRAINT "orc_empregado_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_empregado" ADD CONSTRAINT "orc_empregado_versao_proposta_id_fkey" FOREIGN KEY ("versao_proposta_id") REFERENCES "orc_versao_proposta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_empregado" ADD CONSTRAINT "orc_empregado_meta_id_fkey" FOREIGN KEY ("meta_id") REFERENCES "orc_meta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_qtde_empregado" ADD CONSTRAINT "orc_qtde_empregado_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_qtde_empregado" ADD CONSTRAINT "orc_qtde_empregado_versao_proposta_id_fkey" FOREIGN KEY ("versao_proposta_id") REFERENCES "orc_versao_proposta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_qtde_empregado" ADD CONSTRAINT "orc_qtde_empregado_meta_id_fkey" FOREIGN KEY ("meta_id") REFERENCES "orc_meta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A ordem recomeça a cada meta da versão (RN0242); na Consolidada, a meta nula é um grupo só. O Prisma
-- não declara NULLS NOT DISTINCT; na corrida, quem perde recebe a violação deste índice.
CREATE UNIQUE INDEX "orc_empregado_versao_meta_ordem_key" ON "orc_empregado" ("versao_proposta_id", "meta_id", "ordem") NULLS NOT DISTINCT;

-- 3) Regras (UC03.21, UC03.25, D-P20-2, D-P20-3, D-P20-6). Os limites espelham o domain/empregado.ts e o
--    motor do cad (salário > 0 e < 1.000.000,00). Competência é sempre o dia 1 do mês.
ALTER TABLE "orc_empregado"
  ADD CONSTRAINT "orc_empregado_ordem_check" CHECK ("ordem" >= 1),
  ADD CONSTRAINT "orc_empregado_categoria_check" CHECK ("categoria" IN ('EMPREGADO', 'ESTAGIARIO', 'JOVEM_APRENDIZ')),
  ADD CONSTRAINT "orc_empregado_nome_check" CHECK ("nome" IS NULL OR char_length(btrim("nome")) BETWEEN 1 AND 120),
  ADD CONSTRAINT "orc_empregado_salario_check" CHECK ("salario_mensal" > 0 AND "salario_mensal" < 1000000),
  ADD CONSTRAINT "orc_empregado_competencia_check" CHECK (extract(day FROM "inicio") = 1 AND extract(day FROM "fim") = 1 AND "inicio" <= "fim"),
  ADD CONSTRAINT "orc_empregado_dependentes_check" CHECK ("dependentes" BETWEEN 0 AND 20),
  ADD CONSTRAINT "orc_empregado_versao_check" CHECK ("versao" >= 0);

ALTER TABLE "orc_qtde_empregado"
  ADD CONSTRAINT "orc_qtde_empregado_documento_check" CHECK (char_length(btrim("documento")) BETWEEN 1 AND 50),
  ADD CONSTRAINT "orc_qtde_empregado_competencia_check" CHECK (extract(day FROM "inicio") = 1 AND extract(day FROM "fim") = 1 AND "inicio" <= "fim"),
  ADD CONSTRAINT "orc_qtde_empregado_versao_check" CHECK ("versao" >= 0);

-- O lançamento é da mesma unidade da versão, e a meta (quando há) é da mesma versão: a RLS de uma vale
-- para a outra, e um id de meta de outra versão não entra nem por fora do caso de uso.
CREATE FUNCTION orc_pessoal_mesma_versao() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "orc_versao_proposta" v WHERE v.id = NEW.versao_proposta_id AND v.unidade_id = NEW.unidade_id) THEN
    RAISE EXCEPTION 'orc.pessoal_outra_unidade' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.meta_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "orc_meta" m WHERE m.id = NEW.meta_id AND m.versao_proposta_id = NEW.versao_proposta_id) THEN
    RAISE EXCEPTION 'orc.pessoal_meta_de_outra_versao' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER orc_empregado_mesma_versao BEFORE INSERT OR UPDATE OF "unidade_id", "versao_proposta_id", "meta_id" ON "orc_empregado"
  FOR EACH ROW EXECUTE FUNCTION orc_pessoal_mesma_versao();
CREATE TRIGGER orc_qtde_empregado_mesma_versao BEFORE INSERT OR UPDATE OF "unidade_id", "versao_proposta_id", "meta_id" ON "orc_qtde_empregado"
  FOR EACH ROW EXECUTE FUNCTION orc_pessoal_mesma_versao();
REVOKE EXECUTE ON FUNCTION orc_pessoal_mesma_versao() FROM PUBLIC;

-- 4) RLS por unidade (US-007): a política padrão.
ALTER TABLE "orc_empregado" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orc_empregado_unidade" ON "orc_empregado"
  USING (unidade_id = ANY ((SELECT app_unidades())::uuid[])) WITH CHECK (unidade_id = ANY ((SELECT app_unidades())::uuid[]));
ALTER TABLE "orc_qtde_empregado" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orc_qtde_empregado_unidade" ON "orc_qtde_empregado"
  USING (unidade_id = ANY ((SELECT app_unidades())::uuid[])) WITH CHECK (unidade_id = ANY ((SELECT app_unidades())::uuid[]));

-- 5) Privilégios (spec §11.5). O sincronismo do ERP não toca no pessoal da proposta. A aplicação insere,
--    lê e apaga (exclusão física, UC03.23 e UC03.27); a versão, a meta, a ordem e a unidade não mudam
--    (Origem Blindada, UC03.22 e UC03.26).
REVOKE ALL ON "orc_empregado" FROM sgo_sync;
REVOKE UPDATE ON "orc_empregado" FROM sgo_app;
GRANT UPDATE ("categoria", "nome", "cargo_id", "salario_mensal", "inicio", "fim", "dependentes", "versao") ON "orc_empregado" TO sgo_app;
REVOKE ALL ON "orc_qtde_empregado" FROM sgo_sync;
REVOKE UPDATE ON "orc_qtde_empregado" FROM sgo_app;
GRANT UPDATE ("inicio", "fim", "documento", "versao") ON "orc_qtde_empregado" TO sgo_app;
