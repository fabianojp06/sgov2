-- Parâmetros locais da conta analítica (US-045, #67; RF_PLA_REQ_003, C7, C27): natureza OPEX/CAPEX e,
-- opcionalmente, faixas do semáforo próprias da conta. Sem faixas próprias, valem as do exercício
-- (parametros_exercicio). Só parâmetros locais: a estrutura do plano de contas não muda (C27).

-- CreateEnum
CREATE TYPE "NaturezaConta" AS ENUM ('OPEX', 'CAPEX');

-- CreateTable
CREATE TABLE "conta_parametro_local" (
    "conta_id" UUID NOT NULL,
    "natureza" "NaturezaConta",
    "semaforo_verde_ate" DECIMAL(9,4),
    "semaforo_amarelo_ate" DECIMAL(9,4),
    "semaforo_laranja_ate" DECIMAL(9,4),
    "versao" INTEGER NOT NULL DEFAULT 1,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "conta_parametro_local_pkey" PRIMARY KEY ("conta_id")
);

-- AddForeignKey
ALTER TABLE "conta_parametro_local" ADD CONSTRAINT "conta_parametro_local_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "conta_contabil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Faixas: as três ou nenhuma, na ordem e com as mesmas fronteiras das do exercício (RN_PLA_006). O
-- IS NOT NULL explícito é necessário: uma comparação com NULL dá desconhecido, e a CHECK aceitaria.
ALTER TABLE "conta_parametro_local" ADD CONSTRAINT "conta_parametro_local_semaforo_check" CHECK (
  ("semaforo_verde_ate" IS NULL AND "semaforo_amarelo_ate" IS NULL AND "semaforo_laranja_ate" IS NULL)
  OR ("semaforo_verde_ate" IS NOT NULL AND "semaforo_amarelo_ate" IS NOT NULL AND "semaforo_laranja_ate" IS NOT NULL
      AND 0 <= "semaforo_verde_ate" AND "semaforo_verde_ate" < "semaforo_amarelo_ate"
      AND "semaforo_amarelo_ate" < "semaforo_laranja_ate" AND "semaforo_laranja_ate" <= 999)
);
ALTER TABLE "conta_parametro_local" ADD CONSTRAINT "conta_parametro_local_versao_check" CHECK ("versao" >= 1);

-- Só conta analítica (a sintética não recebe lançamento nem parâmetro local).
CREATE FUNCTION "cad_parametro_local_so_analitica"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "conta_contabil" WHERE "id" = NEW."conta_id" AND "tipo" = 'ANALITICA') THEN
    RAISE EXCEPTION 'Parâmetro local só em conta analítica' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "conta_parametro_local_so_analitica" BEFORE INSERT OR UPDATE OF "conta_id" ON "conta_parametro_local"
  FOR EACH ROW EXECUTE FUNCTION "cad_parametro_local_so_analitica"();

-- Privilégios: o app inclui e altera o conteúdo, sem apagar; o sgo_sync não toca.
REVOKE ALL ON "conta_parametro_local" FROM sgo_app, sgo_sync;
GRANT SELECT, INSERT ON "conta_parametro_local" TO sgo_app;
GRANT UPDATE ("natureza", "semaforo_verde_ate", "semaforo_amarelo_ate", "semaforo_laranja_ate", "versao", "atualizado_em")
  ON "conta_parametro_local" TO sgo_app;
