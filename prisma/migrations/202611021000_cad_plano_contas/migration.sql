-- CreateEnum
CREATE TYPE "TipoConta" AS ENUM ('SINTETICA', 'ANALITICA');

-- CreateEnum
CREATE TYPE "TipoCarga" AS ENUM ('PLANO_CONTAS', 'CENTROS_CUSTO', 'CARGOS', 'CARGOS_RECIFRA');

-- CreateEnum
CREATE TYPE "SituacaoCarga" AS ENUM ('PENDENTE', 'PROCESSANDO', 'CONCLUIDA', 'FALHOU');

-- CreateTable
CREATE TABLE "conta_contabil" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "classificacao" TEXT NOT NULL,
    "codigo_reduzido" TEXT,
    "descricao" TEXT NOT NULL,
    "nivel" SMALLINT NOT NULL,
    "tipo" "TipoConta" NOT NULL,
    "pai_id" UUID,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "inativada_em" TIMESTAMPTZ(6),
    "carga_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "conta_contabil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carga_estrutura" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tipo" "TipoCarga" NOT NULL,
    "grupo" TEXT NOT NULL DEFAULT '',
    "situacao" "SituacaoCarga" NOT NULL DEFAULT 'PENDENTE',
    "arquivo_nome" TEXT NOT NULL,
    "arquivo_sha256" TEXT NOT NULL,
    "linhas" INTEGER NOT NULL,
    "incluidas" INTEGER,
    "alteradas" INTEGER,
    "inativadas" INTEGER,
    "inalteradas" INTEGER,
    "avisos" JSONB,
    "erros" JSONB,
    "erro" TEXT,
    "provisoria" BOOLEAN NOT NULL DEFAULT false,
    "aprovacao_data" DATE,
    "aprovacao_documento" TEXT,
    "contexto_auditoria" JSONB NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "processando_desde" TIMESTAMPTZ(6),
    "concluido_em" TIMESTAMPTZ(6),

    CONSTRAINT "carga_estrutura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carga_estrutura_linha" (
    "carga_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "dados" JSONB NOT NULL,

    CONSTRAINT "carga_estrutura_linha_pkey" PRIMARY KEY ("carga_id","numero")
);

-- CreateIndex
CREATE UNIQUE INDEX "conta_contabil_classificacao_key" ON "conta_contabil"("classificacao");

-- CreateIndex
CREATE INDEX "conta_contabil_pai_id_idx" ON "conta_contabil"("pai_id");

-- CreateIndex
CREATE INDEX "carga_estrutura_situacao_criado_em_idx" ON "carga_estrutura"("situacao", "criado_em");

-- AddForeignKey
ALTER TABLE "conta_contabil" ADD CONSTRAINT "conta_contabil_pai_id_fkey" FOREIGN KEY ("pai_id") REFERENCES "conta_contabil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conta_contabil" ADD CONSTRAINT "conta_contabil_carga_id_fkey" FOREIGN KEY ("carga_id") REFERENCES "carga_estrutura"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carga_estrutura_linha" ADD CONSTRAINT "carga_estrutura_linha_carga_id_fkey" FOREIGN KEY ("carga_id") REFERENCES "carga_estrutura"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Regras que o schema do Prisma não expressa (plano do P4, Task 4b; spec §6.1).

-- Plano de contas: formato e coerência da linha.
ALTER TABLE "conta_contabil" ADD CONSTRAINT "conta_contabil_regras_check" CHECK (
  "nivel" BETWEEN 1 AND 5
  AND "classificacao" ~ '^[0-9]+(\.[0-9]+)*$'
  AND array_length(string_to_array("classificacao", '.'), 1) = "nivel"
  AND ("tipo" = 'ANALITICA') = ("nivel" = 5)
  AND ("tipo" = 'ANALITICA') = ("codigo_reduzido" IS NOT NULL)
  AND ("nivel" = 1) = ("pai_id" IS NULL)
  AND "ativa" = ("inativada_em" IS NULL)
  AND length("descricao") BETWEEN 1 AND 200
);
-- O reduzido é a chave de casamento com o ERP: único entre as ativas.
CREATE UNIQUE INDEX "conta_contabil_reduzido_ativa_key" ON "conta_contabil" ("codigo_reduzido") WHERE "ativa";

-- R5: a estrutura de uma classificação nunca muda; a recarga só muda descrição e situação.
CREATE FUNCTION "cad_conta_imutavel"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."classificacao" IS DISTINCT FROM OLD."classificacao" OR NEW."nivel" IS DISTINCT FROM OLD."nivel"
    OR NEW."tipo" IS DISTINCT FROM OLD."tipo" OR NEW."pai_id" IS DISTINCT FROM OLD."pai_id"
    OR NEW."codigo_reduzido" IS DISTINCT FROM OLD."codigo_reduzido" OR NEW."id" IS DISTINCT FROM OLD."id" THEN
    RAISE EXCEPTION 'A estrutura de uma conta não muda (classificação, nível, tipo, conta superior e reduzido)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW IS DISTINCT FROM OLD THEN
    NEW."atualizado_em" := clock_timestamp();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "conta_contabil_imutavel" BEFORE UPDATE ON "conta_contabil"
  FOR EACH ROW EXECUTE FUNCTION "cad_conta_imutavel"();

-- Árvore coerente, conferida no fim da transação (a carga grava pais e filhos em qualquer ordem):
-- pai sintético com nível − 1 e classificação prefixo; registro ativo com pai ativo (M-n3);
-- sintética ativa com pelo menos um filho ativo.
CREATE FUNCTION "cad_conta_arvore"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  pai "conta_contabil";
  atual "conta_contabil";
BEGIN
  SELECT * INTO atual FROM "conta_contabil" WHERE "id" = NEW."id";
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF atual."pai_id" IS NOT NULL THEN
    SELECT * INTO pai FROM "conta_contabil" WHERE "id" = atual."pai_id";
    IF pai."tipo" <> 'SINTETICA' OR pai."nivel" <> atual."nivel" - 1
      OR left(atual."classificacao", length(pai."classificacao") + 1) <> pai."classificacao" || '.' THEN
      RAISE EXCEPTION 'Conta % fora da árvore: a conta superior deve ser sintética, do nível acima e prefixo da classificação',
        atual."classificacao" USING ERRCODE = 'check_violation';
    END IF;
    IF atual."ativa" AND NOT pai."ativa" THEN
      RAISE EXCEPTION 'Conta % ativa sob conta superior inativa', atual."classificacao" USING ERRCODE = 'check_violation';
    END IF;
    IF pai."ativa" AND NOT EXISTS (SELECT 1 FROM "conta_contabil" WHERE "pai_id" = pai."id" AND "ativa") THEN
      RAISE EXCEPTION 'Conta sintética % ativa sem conta ativa abaixo', pai."classificacao" USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF atual."tipo" = 'SINTETICA' AND atual."ativa"
    AND NOT EXISTS (SELECT 1 FROM "conta_contabil" WHERE "pai_id" = atual."id" AND "ativa") THEN
    RAISE EXCEPTION 'Conta sintética % ativa sem conta ativa abaixo', atual."classificacao" USING ERRCODE = 'check_violation';
  END IF;
  IF NOT atual."ativa" AND EXISTS (SELECT 1 FROM "conta_contabil" WHERE "pai_id" = atual."id" AND "ativa") THEN
    RAISE EXCEPTION 'Conta % inativa com conta ativa abaixo', atual."classificacao" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "conta_contabil_arvore" AFTER INSERT OR UPDATE ON "conta_contabil"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "cad_conta_arvore"();

-- Lote de carga (R6, S-N3): nasce PENDENTE e sem resultado; o grupo vem do tipo (m5); a entrada
-- não muda depois; lote terminado (CONCLUIDA ou FALHOU) nunca volta a ser processado.
CREATE FUNCTION "cad_carga_entrada"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."situacao" <> 'PENDENTE' OR NEW."incluidas" IS NOT NULL OR NEW."alteradas" IS NOT NULL
    OR NEW."inativadas" IS NOT NULL OR NEW."inalteradas" IS NOT NULL OR NEW."avisos" IS NOT NULL
    OR NEW."erros" IS NOT NULL OR NEW."erro" IS NOT NULL OR NEW."processando_desde" IS NOT NULL
    OR NEW."concluido_em" IS NOT NULL THEN
    RAISE EXCEPTION 'Lote de carga nasce PENDENTE e sem resultado' USING ERRCODE = 'check_violation';
  END IF;
  NEW."grupo" := CASE NEW."tipo" WHEN 'CARGOS_RECIFRA' THEN 'CARGOS' ELSE NEW."tipo"::text END;
  NEW."criado_em" := clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER "carga_estrutura_entrada" BEFORE INSERT ON "carga_estrutura"
  FOR EACH ROW EXECUTE FUNCTION "cad_carga_entrada"();

CREATE FUNCTION "cad_carga_transicao"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."situacao" IN ('CONCLUIDA', 'FALHOU') THEN
    RAISE EXCEPTION 'Lote de carga terminado não muda' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."tipo" IS DISTINCT FROM OLD."tipo" OR NEW."grupo" IS DISTINCT FROM OLD."grupo"
    OR NEW."arquivo_nome" IS DISTINCT FROM OLD."arquivo_nome" OR NEW."arquivo_sha256" IS DISTINCT FROM OLD."arquivo_sha256"
    OR NEW."linhas" IS DISTINCT FROM OLD."linhas" OR NEW."provisoria" IS DISTINCT FROM OLD."provisoria"
    OR NEW."aprovacao_data" IS DISTINCT FROM OLD."aprovacao_data"
    OR NEW."aprovacao_documento" IS DISTINCT FROM OLD."aprovacao_documento"
    OR NEW."contexto_auditoria" IS DISTINCT FROM OLD."contexto_auditoria" OR NEW."criado_em" IS DISTINCT FROM OLD."criado_em" THEN
    RAISE EXCEPTION 'A entrada de um lote de carga não muda' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "carga_estrutura_transicao" BEFORE UPDATE ON "carga_estrutura"
  FOR EACH ROW EXECUTE FUNCTION "cad_carga_transicao"();

-- Uma carga por grupo em andamento (RNF_PLA_REQ_007; CARGOS e CARGOS_RECIFRA juntos, m5).
CREATE UNIQUE INDEX "carga_estrutura_grupo_andamento_key" ON "carga_estrutura" ("grupo")
  WHERE "situacao" IN ('PENDENTE', 'PROCESSANDO');

-- Privilégios (R6): o app só lê a estrutura e grava o pedido de carga; o merge é do sgo_sync no
-- worker. Ninguém além do migrator apaga estrutura.
REVOKE ALL ON "conta_contabil", "carga_estrutura", "carga_estrutura_linha" FROM sgo_app, sgo_sync;
GRANT SELECT ON "conta_contabil" TO sgo_app;
GRANT SELECT, INSERT, UPDATE ON "conta_contabil" TO sgo_sync;
GRANT SELECT ON "carga_estrutura" TO sgo_app;
GRANT INSERT ("id", "tipo", "arquivo_nome", "arquivo_sha256", "linhas", "provisoria", "aprovacao_data",
  "aprovacao_documento", "contexto_auditoria") ON "carga_estrutura" TO sgo_app;
GRANT SELECT, UPDATE ON "carga_estrutura" TO sgo_sync;
GRANT INSERT ON "carga_estrutura_linha" TO sgo_app;
GRANT SELECT, DELETE ON "carga_estrutura_linha" TO sgo_sync;
