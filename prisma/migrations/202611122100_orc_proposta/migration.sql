-- Proposta de TP: capa, Versão 1 e CC próprio (US-065; plano do P17, Task 1). SQL à mão, no formato
-- que o Prisma gera para o schema (orc.prisma e nucleo.prisma), conferido pelos testes de integração
-- (que aplicam as migrations num banco descartável). Nenhuma tabela da frente B é tocada.

-- 1) CC próprio do TP na unidade (C37, D-P17-7). O TP é a unidade (§6.7): a tabela é global e sem RLS,
--    então a lista dos CCs livres e a RN_TP_001 enxergam todos os TPs sem abrir dado de TP. A
--    classificação é a do C1, sem FK (§12.7, item 1). Nulo nas unidades que não são TP.
ALTER TABLE "unidade" ADD COLUMN "cc" TEXT;
ALTER TABLE "unidade" ADD CONSTRAINT "unidade_cc_check" CHECK ("cc" IS NULL OR char_length(btrim("cc")) BETWEEN 1 AND 60);
-- Um CC por TP ativo (RN_TP_001). Excluir a proposta inativa a unidade e libera o CC (D-P17-10). O
-- Prisma não declara índice parcial; na corrida, quem perde recebe a violação deste índice.
CREATE UNIQUE INDEX "unidade_cc_ativa_key" ON "unidade" ("cc") WHERE "ativo" AND "cc" IS NOT NULL;
-- O número do TP (unidade.codigo) é único também sem diferença de maiúsculas: TP-001 e tp-001 seriam o
-- mesmo TP (revisão 12.12 do P17). Vale para toda unidade; o índice de expressão não entra no schema.
CREATE UNIQUE INDEX "unidade_codigo_maiusculas_key" ON "unidade" (upper("codigo"));

-- 2) Capa da proposta. Uma por unidade. Número do TP = unidade.codigo (único e imutável, também
--    depois da exclusão); Valor Global sem coluna: é sempre calculado (§6.2, RN_TP_003).
-- CreateTable
CREATE TABLE "orc_proposta" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "unidade_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "objeto" TEXT NOT NULL,
    "parceiro" TEXT,
    "inicio" DATE NOT NULL,
    "fim" DATE NOT NULL,
    "categoria" TEXT NOT NULL,
    "criado_por" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "excluida_em" TIMESTAMPTZ(6),
    "excluida_por" UUID,
    "versao" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "orc_proposta_pkey" PRIMARY KEY ("id")
);

-- 3) Versões da proposta (§6.2). A nº 1 nasce em Rascunho (RN_PROP_002, D-P17-6).
-- CreateTable
CREATE TABLE "orc_versao_proposta" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "unidade_id" UUID NOT NULL,
    "proposta_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "situacao" TEXT NOT NULL DEFAULT 'RASCUNHO',
    "criado_por" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "orc_versao_proposta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orc_proposta_unidade_id_key" ON "orc_proposta"("unidade_id");

-- CreateIndex
CREATE INDEX "orc_versao_proposta_unidade_id_idx" ON "orc_versao_proposta"("unidade_id");

-- CreateIndex
CREATE UNIQUE INDEX "orc_versao_proposta_proposta_id_numero_key" ON "orc_versao_proposta"("proposta_id", "numero");

-- AddForeignKey
ALTER TABLE "orc_proposta" ADD CONSTRAINT "orc_proposta_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_versao_proposta" ADD CONSTRAINT "orc_versao_proposta_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_versao_proposta" ADD CONSTRAINT "orc_versao_proposta_proposta_id_fkey" FOREIGN KEY ("proposta_id") REFERENCES "orc_proposta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4) Regras da capa e da versão (UC 3.05, D-P17-4 e D-P17-5). Os limites espelham o domain/proposta.ts.
ALTER TABLE "orc_proposta"
  ADD CONSTRAINT "orc_proposta_tipo_check" CHECK ("tipo" IN ('CONTRATO', 'TERMO_PARCERIA')),
  ADD CONSTRAINT "orc_proposta_categoria_check" CHECK ("categoria" IN ('CONSOLIDADA', 'META')),
  ADD CONSTRAINT "orc_proposta_objeto_check" CHECK (char_length(btrim("objeto")) BETWEEN 1 AND 500),
  ADD CONSTRAINT "orc_proposta_parceiro_check" CHECK ("parceiro" IS NULL OR char_length(btrim("parceiro")) BETWEEN 1 AND 200),
  -- RN_TP_002: término pelo menos 30 dias civis depois do início.
  ADD CONSTRAINT "orc_proposta_vigencia_check" CHECK ("fim" >= "inicio" + 30),
  ADD CONSTRAINT "orc_proposta_exclusao_check" CHECK (("excluida_em" IS NULL) = ("excluida_por" IS NULL)),
  ADD CONSTRAINT "orc_proposta_versao_check" CHECK ("versao" >= 0);

ALTER TABLE "orc_versao_proposta"
  ADD CONSTRAINT "orc_versao_proposta_numero_check" CHECK ("numero" >= 1),
  ADD CONSTRAINT "orc_versao_proposta_situacao_check" CHECK (
    "situacao" IN ('RASCUNHO', 'EM_ELABORACAO', 'EM_APROVACAO', 'OFICIALIZADO', 'ENCERRADO'));

-- A versão é da mesma unidade da proposta: a RLS de uma vale para a outra. Função de trigger comum
-- (SECURITY INVOKER): lê a proposta com o papel e a RLS de quem grava.
CREATE FUNCTION orc_versao_proposta_mesma_unidade() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "orc_proposta" p WHERE p.id = NEW.proposta_id AND p.unidade_id = NEW.unidade_id) THEN
    RAISE EXCEPTION 'orc.versao_proposta_outra_unidade' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER orc_versao_proposta_mesma_unidade BEFORE INSERT OR UPDATE OF "unidade_id", "proposta_id" ON "orc_versao_proposta"
  FOR EACH ROW EXECUTE FUNCTION orc_versao_proposta_mesma_unidade();
REVOKE EXECUTE ON FUNCTION orc_versao_proposta_mesma_unidade() FROM PUBLIC;

-- 5) RLS por unidade (US-007): a política padrão da migration 202611041400_nucleo_app_unidades. O
--    caso de uso, depois de criar a unidade, refaz o app.unidades da transação com ela incluída.
ALTER TABLE "orc_proposta" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orc_proposta_unidade" ON "orc_proposta"
  USING (unidade_id = ANY ((SELECT app_unidades())::uuid[])) WITH CHECK (unidade_id = ANY ((SELECT app_unidades())::uuid[]));
ALTER TABLE "orc_versao_proposta" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orc_versao_proposta_unidade" ON "orc_versao_proposta"
  USING (unidade_id = ANY ((SELECT app_unidades())::uuid[])) WITH CHECK (unidade_id = ANY ((SELECT app_unidades())::uuid[]));

-- 6) Privilégios (spec §11.5). O sincronismo do ERP não toca na proposta. A aplicação insere e lê;
--    nunca apaga (exclusão lógica, RN_MAN_006); na capa só atualiza a exclusão e a versão de
--    concorrência; a versão da proposta ainda não muda (o ciclo de vida vem nas histórias seguintes).
--    Na unidade, o INSERT (com o cc) já é da aplicação pelos privilégios padrão; o UPDATE continua só em
--    nome e ativo (202610260500_adm_unidade): o cc e o código não mudam.
REVOKE ALL ON "orc_proposta", "orc_versao_proposta" FROM sgo_sync;
REVOKE UPDATE, DELETE ON "orc_proposta", "orc_versao_proposta" FROM sgo_app;
GRANT UPDATE ("excluida_em", "excluida_por", "versao") ON "orc_proposta" TO sgo_app;
