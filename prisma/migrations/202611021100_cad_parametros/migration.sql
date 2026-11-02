-- CreateTable
CREATE TABLE "parametros_exercicio" (
    "ano" SMALLINT NOT NULL,
    "reajuste" DECIMAL(9,4) NOT NULL,
    "mes_data_base" SMALLINT NOT NULL,
    "ipca" DECIMAL(9,4) NOT NULL,
    "salario_minimo" DECIMAL(15,2),
    "dias_uteis_mes" SMALLINT NOT NULL,
    "semaforo_verde_ate" DECIMAL(9,4) NOT NULL,
    "semaforo_amarelo_ate" DECIMAL(9,4) NOT NULL,
    "semaforo_laranja_ate" DECIMAL(9,4) NOT NULL,
    "provisorio" BOOLEAN NOT NULL DEFAULT true,
    "congelado_em" TIMESTAMPTZ(6),
    "versao" INTEGER NOT NULL DEFAULT 1,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "parametros_exercicio_pkey" PRIMARY KEY ("ano")
);

-- CreateTable
CREATE TABLE "encargo_exercicio" (
    "ano" SMALLINT NOT NULL,
    "componente" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "percentual" DECIMAL(9,4) NOT NULL,
    "conta" TEXT NOT NULL,
    "provisorio" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "encargo_exercicio_pkey" PRIMARY KEY ("ano","componente")
);

-- CreateTable
CREATE TABLE "conta_componente_exercicio" (
    "ano" SMALLINT NOT NULL,
    "componente" TEXT NOT NULL,
    "conta" TEXT NOT NULL,
    "provisorio" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "conta_componente_exercicio_pkey" PRIMARY KEY ("ano","componente")
);

-- CreateTable
CREATE TABLE "parametro_sistema" (
    "chave" TEXT NOT NULL,
    "valor" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "parametro_sistema_pkey" PRIMARY KEY ("chave")
);

-- AddForeignKey
ALTER TABLE "encargo_exercicio" ADD CONSTRAINT "encargo_exercicio_ano_fkey" FOREIGN KEY ("ano") REFERENCES "parametros_exercicio"("ano") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conta_componente_exercicio" ADD CONSTRAINT "conta_componente_exercicio_ano_fkey" FOREIGN KEY ("ano") REFERENCES "parametros_exercicio"("ano") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Regras que o schema do Prisma não expressa (plano do P4, Task 9a; R10).
ALTER TABLE "parametros_exercicio" ADD CONSTRAINT "parametros_exercicio_faixas_check" CHECK (
  "ano" BETWEEN 2000 AND 2099
  AND "mes_data_base" BETWEEN 1 AND 12
  AND "dias_uteis_mes" BETWEEN 1 AND 31
  AND "reajuste" BETWEEN 0 AND 100
  AND "ipca" BETWEEN -100 AND 100
  AND ("salario_minimo" IS NULL OR "salario_minimo" > 0)
  AND 0 <= "semaforo_verde_ate" AND "semaforo_verde_ate" < "semaforo_amarelo_ate"
  AND "semaforo_amarelo_ate" < "semaforo_laranja_ate"
  AND "versao" >= 1
);
ALTER TABLE "encargo_exercicio" ADD CONSTRAINT "encargo_exercicio_regras_check" CHECK (
  "componente" IN ('encargo.inss', 'encargo.fgts', 'encargo.pis', 'encargo.obrigacoes', 'encargo.riscos')
  AND "percentual" BETWEEN 0 AND 100
);
ALTER TABLE "conta_componente_exercicio" ADD CONSTRAINT "conta_componente_exercicio_regras_check" CHECK (
  "componente" IN ('salario', 'adicional', 'ferias', 'decimo_terceiro')
);

-- Ano congelado (oficializado pela frente A) não muda: defesa no banco, além do app (R10).
CREATE FUNCTION "cad_exercicio_congelado"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ano_alvo smallint;
BEGIN
  IF TG_TABLE_NAME = 'parametros_exercicio' THEN
    IF OLD."congelado_em" IS NOT NULL THEN
      RAISE EXCEPTION 'Os parâmetros do exercício % estão congelados', OLD."ano" USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  ano_alvo := CASE WHEN TG_OP = 'DELETE' THEN OLD."ano" ELSE NEW."ano" END;
  IF EXISTS (SELECT 1 FROM "parametros_exercicio" WHERE "ano" = ano_alvo AND "congelado_em" IS NOT NULL) THEN
    RAISE EXCEPTION 'Os parâmetros do exercício % estão congelados', ano_alvo USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER "parametros_exercicio_congelado" BEFORE UPDATE ON "parametros_exercicio"
  FOR EACH ROW EXECUTE FUNCTION "cad_exercicio_congelado"();
CREATE TRIGGER "encargo_exercicio_congelado" BEFORE INSERT OR UPDATE OR DELETE ON "encargo_exercicio"
  FOR EACH ROW EXECUTE FUNCTION "cad_exercicio_congelado"();
CREATE TRIGGER "conta_componente_exercicio_congelado" BEFORE INSERT OR UPDATE OR DELETE ON "conta_componente_exercicio"
  FOR EACH ROW EXECUTE FUNCTION "cad_exercicio_congelado"();

-- Privilégios (B1): o sgo_sync não toca nos parâmetros; o app não apaga nem muda a chave do ano.
REVOKE ALL ON "parametros_exercicio", "encargo_exercicio", "conta_componente_exercicio", "parametro_sistema" FROM sgo_sync;
REVOKE DELETE ON "parametros_exercicio", "encargo_exercicio", "conta_componente_exercicio", "parametro_sistema" FROM sgo_app;
-- Chaves e congelamento só pelo caminho certo: o app cria o ano (garantir), altera os valores e
-- congela; a chave do parâmetro do sistema vem da seed.
REVOKE UPDATE ON "parametros_exercicio" FROM sgo_app;
GRANT UPDATE ("reajuste", "mes_data_base", "ipca", "salario_minimo", "dias_uteis_mes", "semaforo_verde_ate",
  "semaforo_amarelo_ate", "semaforo_laranja_ate", "provisorio", "congelado_em", "versao", "atualizado_em")
  ON "parametros_exercicio" TO sgo_app;
REVOKE UPDATE ON "encargo_exercicio" FROM sgo_app;
GRANT UPDATE ("nome", "percentual", "conta", "provisorio") ON "encargo_exercicio" TO sgo_app;
REVOKE UPDATE ON "conta_componente_exercicio" FROM sgo_app;
GRANT UPDATE ("conta", "provisorio") ON "conta_componente_exercicio" TO sgo_app;
REVOKE INSERT, UPDATE ON "parametro_sistema" FROM sgo_app;
GRANT UPDATE ("valor") ON "parametro_sistema" TO sgo_app;
