-- Bens, serviços e equipamentos (CAPEX) da proposta de TP (US-072; plano do P22, Task 1). SQL à mão, no
-- formato que o Prisma gera para o schema (orc.prisma), conferido pelos testes de integração. Nenhuma tabela
-- da frente B é tocada.

-- 1) Bem da versão da proposta (D-P22-2): meta obrigatória na categoria Meta (no caso de uso) com FK
--    RESTRICT (RN0136). A conta é a classificação do C1 (R5), sem FK. O valor total não é gravado (RN0157).
--    O bem copiado de uma versão anterior guarda a origem e, ao sair, é inativado (RN_PLA_11, D-P22-6).
-- CreateTable
CREATE TABLE "orc_bem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "unidade_id" UUID NOT NULL,
    "versao_proposta_id" UUID NOT NULL,
    "meta_id" UUID,
    "conta" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "valor_unitario" DECIMAL(15,2) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "inativado_em" TIMESTAMPTZ(6),
    "origem_id" UUID,
    "criado_por" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "versao" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "orc_bem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orc_bem_unidade_id_idx" ON "orc_bem"("unidade_id");

-- CreateIndex
CREATE INDEX "orc_bem_versao_proposta_id_idx" ON "orc_bem"("versao_proposta_id");

-- CreateIndex
CREATE INDEX "orc_bem_meta_id_idx" ON "orc_bem"("meta_id");

-- AddForeignKey
ALTER TABLE "orc_bem" ADD CONSTRAINT "orc_bem_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_bem" ADD CONSTRAINT "orc_bem_versao_proposta_id_fkey" FOREIGN KEY ("versao_proposta_id") REFERENCES "orc_versao_proposta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_bem" ADD CONSTRAINT "orc_bem_meta_id_fkey" FOREIGN KEY ("meta_id") REFERENCES "orc_meta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2) Regras (REQ0290, RN0157, D-P22-2 e D-P22-6). Os limites espelham o domain/bem.ts.
ALTER TABLE "orc_bem"
  ADD CONSTRAINT "orc_bem_conta_check" CHECK (char_length(btrim("conta")) >= 1),
  ADD CONSTRAINT "orc_bem_descricao_check" CHECK (char_length(btrim("descricao")) BETWEEN 1 AND 200),
  ADD CONSTRAINT "orc_bem_quantidade_check" CHECK ("quantidade" BETWEEN 1 AND 999999),
  ADD CONSTRAINT "orc_bem_valor_check" CHECK ("valor_unitario" >= 0),
  ADD CONSTRAINT "orc_bem_inativo_check" CHECK ("ativo" = ("inativado_em" IS NULL)),
  ADD CONSTRAINT "orc_bem_versao_check" CHECK ("versao" >= 0);

-- O bem é da mesma unidade da versão, e a meta (quando há) é da mesma versão: a função do pessoal (P20).
CREATE TRIGGER orc_bem_mesma_versao BEFORE INSERT OR UPDATE OF "unidade_id", "versao_proposta_id", "meta_id" ON "orc_bem"
  FOR EACH ROW EXECUTE FUNCTION orc_pessoal_mesma_versao();

-- 3) RLS por unidade (US-007): a política padrão.
ALTER TABLE "orc_bem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orc_bem_unidade" ON "orc_bem"
  USING (unidade_id = ANY ((SELECT app_unidades())::uuid[])) WITH CHECK (unidade_id = ANY ((SELECT app_unidades())::uuid[]));

-- 4) Privilégios (spec §11.5). O sincronismo do ERP não toca nos bens. A aplicação insere, lê e apaga
--    (o bem nascido na versão, D-P22-6). A versão, a unidade e a origem não mudam; a meta e a conta podem
--    mudar (UC03.36, passo 3); a inativação muda o ativo e a data dela.
REVOKE ALL ON "orc_bem" FROM sgo_sync;
REVOKE UPDATE ON "orc_bem" FROM sgo_app;
GRANT UPDATE ("meta_id", "conta", "descricao", "data", "quantidade", "valor_unitario", "ativo", "inativado_em", "versao") ON "orc_bem" TO sgo_app;
