-- Agrupadores de contas (US-047, #69; RF_PLA_REQ_005, RN_PLA_007–011): rótulos do SGO que reúnem contas
-- analíticas (N:N) para subtotalizar nos relatórios. Não são contas sintéticas nem mexem no plano de
-- contas importado (RN_PLA_007); uma conta pode estar em vários agrupadores (RN_PLA_011).

-- CreateTable
CREATE TABLE "agrupador_conta" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" VARCHAR(100) NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "agrupador_conta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agrupador_conta_item" (
    "agrupador_id" UUID NOT NULL,
    "conta_id" UUID NOT NULL,

    CONSTRAINT "agrupador_conta_item_pkey" PRIMARY KEY ("agrupador_id","conta_id")
);

-- CreateIndex
CREATE INDEX "agrupador_conta_item_conta_id_idx" ON "agrupador_conta_item"("conta_id");

-- AddForeignKey
ALTER TABLE "agrupador_conta_item" ADD CONSTRAINT "agrupador_conta_item_agrupador_id_fkey" FOREIGN KEY ("agrupador_id") REFERENCES "agrupador_conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agrupador_conta_item" ADD CONSTRAINT "agrupador_conta_item_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "conta_contabil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Nome único sem diferenciar maiúsculas (RN_PLA_008), preenchido e sem espaço nas pontas.
CREATE UNIQUE INDEX "agrupador_conta_nome_key" ON "agrupador_conta" (lower("nome"));
ALTER TABLE "agrupador_conta" ADD CONSTRAINT "agrupador_conta_nome_check" CHECK (length("nome") >= 1 AND "nome" = btrim("nome"));
ALTER TABLE "agrupador_conta" ADD CONSTRAINT "agrupador_conta_versao_check" CHECK ("versao" >= 1);

-- Só conta analítica ativa entra no agrupador (a sintética já é um total do plano). Uma recarga que
-- depois inativa a conta não a tira do agrupador: o relatório a mostra como inativa.
CREATE FUNCTION "cad_agrupador_item_so_analitica"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "conta_contabil" WHERE "id" = NEW."conta_id" AND "tipo" = 'ANALITICA' AND "ativa") THEN
    RAISE EXCEPTION 'Agrupador só reúne conta analítica ativa' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "agrupador_conta_item_so_analitica" BEFORE INSERT OR UPDATE ON "agrupador_conta_item"
  FOR EACH ROW EXECUTE FUNCTION "cad_agrupador_item_so_analitica"();

-- Ao menos duas contas (RN_PLA_008), conferido no fim da transação: a inclusão grava o agrupador e
-- depois os itens, e a edição troca os itens. A exclusão do agrupador leva os itens (CASCADE) e não é
-- recusada. O caso de uso trava o agrupador (UPDATE da versão) antes de mexer nos itens, e duas
-- edições do mesmo agrupador não se cruzam.
CREATE FUNCTION "cad_agrupador_minimo_contas"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  alvo UUID;
BEGIN
  IF TG_TABLE_NAME = 'agrupador_conta' THEN alvo := NEW."id"; ELSE alvo := OLD."agrupador_id"; END IF;
  IF EXISTS (SELECT 1 FROM "agrupador_conta" WHERE "id" = alvo)
     AND (SELECT count(*) FROM "agrupador_conta_item" WHERE "agrupador_id" = alvo) < 2 THEN
    RAISE EXCEPTION 'Agrupador com menos de duas contas analíticas' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "agrupador_conta_minimo_contas" AFTER INSERT OR UPDATE ON "agrupador_conta"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "cad_agrupador_minimo_contas"();
CREATE CONSTRAINT TRIGGER "agrupador_conta_item_minimo_contas" AFTER DELETE ON "agrupador_conta_item"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "cad_agrupador_minimo_contas"();

CREATE FUNCTION "cad_agrupador_imutavel"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" <> OLD."id" OR NEW."criado_em" <> OLD."criado_em" THEN
    RAISE EXCEPTION 'O id e a data de criação do agrupador não mudam' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "agrupador_conta_imutavel" BEFORE UPDATE ON "agrupador_conta"
  FOR EACH ROW EXECUTE FUNCTION "cad_agrupador_imutavel"();

-- Privilégios: o app inclui, renomeia e exclui o agrupador e inclui e retira contas; o sgo_sync não
-- toca. Documento orçamentário que um dia referenciar o agrupador o fará com FK RESTRICT, e a exclusão
-- passa a ser recusada enquanto houver referência (RN_PLA_010).
REVOKE ALL ON "agrupador_conta", "agrupador_conta_item" FROM sgo_app, sgo_sync;
GRANT SELECT, DELETE ON "agrupador_conta", "agrupador_conta_item" TO sgo_app;
GRANT INSERT ("nome") ON "agrupador_conta" TO sgo_app;
GRANT UPDATE ("nome", "versao", "atualizado_em") ON "agrupador_conta" TO sgo_app;
GRANT INSERT ("agrupador_id", "conta_id") ON "agrupador_conta_item" TO sgo_app;
