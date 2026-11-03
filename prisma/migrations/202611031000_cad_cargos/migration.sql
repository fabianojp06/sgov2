
-- CreateEnum
CREATE TYPE "FonteAtiva" AS ENUM ('MINIMO', 'MAXIMO', 'TOTAL', 'REAL', 'DEFINIDO');

-- CreateEnum
CREATE TYPE "AdicionalTrabalhista" AS ENUM ('PERICULOSIDADE', 'INSALUBRIDADE');

-- CreateEnum
CREATE TYPE "GrauInsalubridade" AS ENUM ('MINIMO', 'MEDIO', 'MAXIMO');

-- CreateTable
CREATE TABLE "cargo" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "codigo" TEXT NOT NULL,
    "nome_oficial" TEXT NOT NULL,
    "nome_mercado" TEXT,
    "tabela_salarial_codigo" TEXT,
    "tabela_salarial_descricao" TEXT,
    "faixa_codigo" TEXT,
    "faixa_descricao" TEXT,
    "nivel_codigo" TEXT,
    "nivel_descricao" TEXT,
    "salario_real_cifrado" TEXT,
    "funcao_gratificada_cifrada" TEXT,
    "salario_definido_cifrado" TEXT,
    "mercado_minimo" DECIMAL(15,2),
    "mercado_maximo" DECIMAL(15,2),
    "origem_mercado" TEXT,
    "origem_mercado_rotulo" TEXT,
    "fonte_ativa" "FonteAtiva",
    "adicional_tipo" "AdicionalTrabalhista",
    "adicional_grau" "GrauInsalubridade",
    "vinculo_funcional_id" UUID,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "carga_id" UUID,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "cargo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cargo_codigo_key" ON "cargo"("codigo");

-- AddForeignKey
ALTER TABLE "cargo" ADD CONSTRAINT "cargo_carga_id_fkey" FOREIGN KEY ("carga_id") REFERENCES "carga_estrutura"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Regras que o schema do Prisma não expressa (plano do P4, Task 12a).
-- RN_CAR_12: periculosidade sem grau, insalubridade com grau. E3: mínimo de mercado < máximo.
-- R7: as colunas cifradas só aceitam o envelope v1, para um salário em claro nunca ser gravado.
ALTER TABLE "cargo" ADD CONSTRAINT "cargo_regras_check" CHECK (
  ("adicional_tipo" IS NULL AND "adicional_grau" IS NULL)
  OR ("adicional_tipo" = 'PERICULOSIDADE' AND "adicional_grau" IS NULL)
  OR ("adicional_tipo" = 'INSALUBRIDADE' AND "adicional_grau" IS NOT NULL)
);
ALTER TABLE "cargo" ADD CONSTRAINT "cargo_mercado_check" CHECK (
  "mercado_minimo" IS NULL OR "mercado_maximo" IS NULL OR "mercado_minimo" < "mercado_maximo"
);
ALTER TABLE "cargo" ADD CONSTRAINT "cargo_envelopes_check" CHECK (
  ("salario_real_cifrado" IS NULL OR "salario_real_cifrado" ~ '^v1:[A-Za-z0-9_-]{1,20}:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]+$')
  AND ("salario_definido_cifrado" IS NULL OR "salario_definido_cifrado" ~ '^v1:[A-Za-z0-9_-]{1,20}:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]+$')
  AND ("funcao_gratificada_cifrada" IS NULL OR "funcao_gratificada_cifrada" ~ '^v1:[A-Za-z0-9_-]{1,20}:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]+$')
);
ALTER TABLE "cargo" ADD CONSTRAINT "cargo_textos_check" CHECK (
  "codigo" ~ '^[A-Za-z0-9._-]{1,30}$' AND length("nome_oficial") BETWEEN 1 AND 200 AND "versao" >= 1
);

-- O código casa a recarga do Rubi (R20) e entra no AAD da cifra (R7): nunca muda.
CREATE FUNCTION "cad_cargo_imutavel"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."codigo" IS DISTINCT FROM OLD."codigo" OR NEW."id" IS DISTINCT FROM OLD."id" OR NEW."criado_em" IS DISTINCT FROM OLD."criado_em" THEN
    RAISE EXCEPTION 'O código de um cargo não muda' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW IS DISTINCT FROM OLD THEN
    NEW."atualizado_em" := clock_timestamp();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "cargo_imutavel" BEFORE UPDATE ON "cargo"
  FOR EACH ROW EXECUTE FUNCTION "cad_cargo_imutavel"();

-- Privilégios por coluna (B1, R6; m2): o app grava só os campos manuais; o sgo_sync (worker) insere e
-- atualiza só as colunas do Rubi e de controle, nunca um campo manual; ninguém além do migrator apaga.
REVOKE ALL ON "cargo" FROM sgo_app, sgo_sync;
GRANT SELECT ON "cargo" TO sgo_app, sgo_sync;
GRANT UPDATE ("funcao_gratificada_cifrada", "salario_definido_cifrado", "mercado_minimo", "mercado_maximo", "origem_mercado",
  "origem_mercado_rotulo", "fonte_ativa", "adicional_tipo", "adicional_grau", "vinculo_funcional_id", "versao", "atualizado_em")
  ON "cargo" TO sgo_app;
GRANT INSERT ("codigo", "nome_oficial", "nome_mercado", "tabela_salarial_codigo", "tabela_salarial_descricao", "faixa_codigo",
  "faixa_descricao", "nivel_codigo", "nivel_descricao", "salario_real_cifrado", "ativo", "versao", "atualizado_em", "carga_id")
  ON "cargo" TO sgo_sync;
GRANT UPDATE ("codigo", "nome_oficial", "nome_mercado", "tabela_salarial_codigo", "tabela_salarial_descricao", "faixa_codigo",
  "faixa_descricao", "nivel_codigo", "nivel_descricao", "salario_real_cifrado", "ativo", "versao", "atualizado_em", "carga_id")
  ON "cargo" TO sgo_sync;
