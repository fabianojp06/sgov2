-- Oficialização da proposta de TP (US-079; plano do P26, Task 2). SQL à mão, no formato que o Prisma gera para o
-- schema (orc.prisma), conferido pelos testes de integração. Nenhuma tabela da frente B é tocada.

-- 1) Snapshot da versão oficializada (UC6.00 passo 5, RN_WA01_004, D-P26-6): o Valor Global e os totais por conta
--    analítica no momento da aprovação, imutáveis (sem UPDATE nem DELETE para a aplicação).
-- CreateTable
CREATE TABLE "orc_snapshot_versao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "unidade_id" UUID NOT NULL,
    "versao_proposta_id" UUID NOT NULL,
    "valor_global" DECIMAL(15,2) NOT NULL,
    "contas" JSONB NOT NULL,
    "gerado_por" UUID NOT NULL,
    "gerado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "orc_snapshot_versao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orc_snapshot_versao_versao_proposta_id_key" ON "orc_snapshot_versao"("versao_proposta_id");

-- CreateIndex
CREATE INDEX "orc_snapshot_versao_unidade_id_idx" ON "orc_snapshot_versao"("unidade_id");

-- AddForeignKey
ALTER TABLE "orc_snapshot_versao" ADD CONSTRAINT "orc_snapshot_versao_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_snapshot_versao" ADD CONSTRAINT "orc_snapshot_versao_versao_proposta_id_fkey" FOREIGN KEY ("versao_proposta_id") REFERENCES "orc_versao_proposta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "orc_snapshot_versao"
  ADD CONSTRAINT "orc_snapshot_versao_valor_check" CHECK ("valor_global" >= 0),
  ADD CONSTRAINT "orc_snapshot_versao_contas_check" CHECK (jsonb_typeof("contas") = 'object');

CREATE TRIGGER orc_snapshot_versao_mesma_unidade BEFORE INSERT ON "orc_snapshot_versao"
  FOR EACH ROW EXECUTE FUNCTION orc_teto_viagem_mesma_unidade();

ALTER TABLE "orc_snapshot_versao" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orc_snapshot_versao_unidade" ON "orc_snapshot_versao"
  USING (unidade_id = ANY ((SELECT app_unidades())::uuid[])) WITH CHECK (unidade_id = ANY ((SELECT app_unidades())::uuid[]));
REVOKE ALL ON "orc_snapshot_versao" FROM sgo_sync;
REVOKE UPDATE, DELETE ON "orc_snapshot_versao" FROM sgo_app;

-- 2) Ciclo de vida da versão (§6.2, UC03.10, UC6.00; D-P26-2, D-P26-4, D-P26-6 e D-P26-7): a aplicação passa a
--    mudar a situação, e só pelas transições do fluxo. O gatilho é a segunda barreira; a primeira é o caso de uso.
GRANT UPDATE ("situacao") ON "orc_versao_proposta" TO sgo_app;

CREATE FUNCTION orc_versao_proposta_transicao() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.situacao = OLD.situacao THEN
    RETURN NEW;
  END IF;
  IF (OLD.situacao, NEW.situacao) NOT IN (
    ('RASCUNHO', 'EM_ELABORACAO'),
    ('EM_ELABORACAO', 'EM_APROVACAO'),
    ('EM_APROVACAO', 'OFICIALIZADO'),
    ('EM_APROVACAO', 'EM_ELABORACAO')
  ) THEN
    RAISE EXCEPTION 'orc.transicao_invalida' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER orc_versao_proposta_transicao BEFORE UPDATE OF "situacao" ON "orc_versao_proposta"
  FOR EACH ROW EXECUTE FUNCTION orc_versao_proposta_transicao();
REVOKE EXECUTE ON FUNCTION orc_versao_proposta_transicao() FROM PUBLIC;
