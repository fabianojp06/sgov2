-- CreateEnum
CREATE TYPE "FormaBeneficio" AS ENUM ('VALOR_MENSAL', 'VALOR_DIARIO', 'PERCENTUAL_SALARIO');

-- CreateTable
CREATE TABLE "beneficio_mestre" (
    "ano" SMALLINT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "forma" "FormaBeneficio" NOT NULL,
    "valor" DECIMAL(15,2),
    "percentual" DECIMAL(9,4),
    "conta" TEXT NOT NULL,
    "padrao_posicao" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "provisorio" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "beneficio_mestre_pkey" PRIMARY KEY ("ano","codigo")
);

-- AddForeignKey
ALTER TABLE "beneficio_mestre" ADD CONSTRAINT "beneficio_mestre_ano_fkey" FOREIGN KEY ("ano") REFERENCES "parametros_exercicio"("ano") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Regras que o schema do Prisma não expressa (plano do P4, Task 10; R12).
ALTER TABLE "beneficio_mestre" ADD CONSTRAINT "beneficio_mestre_regras_check" CHECK (
  "codigo" ~ '^beneficio\.[a-z][a-z0-9_]{0,40}$'
  AND length("nome") BETWEEN 1 AND 120
  AND (CASE "forma"
    WHEN 'PERCENTUAL_SALARIO' THEN "valor" IS NULL AND ("percentual" IS NULL OR "percentual" BETWEEN 0 AND 100)
    ELSE "percentual" IS NULL AND ("valor" IS NULL OR "valor" >= 0)
  END)
  AND "versao" >= 1
);

-- Ano congelado não muda (mesma função das tabelas do ano, Task 9a).
CREATE TRIGGER "beneficio_mestre_congelado" BEFORE INSERT OR UPDATE OR DELETE ON "beneficio_mestre"
  FOR EACH ROW EXECUTE FUNCTION "cad_exercicio_congelado"();

-- Privilégios (B1): o sgo_sync não toca; o app não apaga e não muda a chave nem a forma de um item.
REVOKE ALL ON "beneficio_mestre" FROM sgo_sync;
REVOKE DELETE ON "beneficio_mestre" FROM sgo_app;
REVOKE UPDATE ON "beneficio_mestre" FROM sgo_app;
GRANT UPDATE ("nome", "valor", "percentual", "conta", "padrao_posicao", "ativo", "provisorio", "versao", "atualizado_em")
  ON "beneficio_mestre" TO sgo_app;
