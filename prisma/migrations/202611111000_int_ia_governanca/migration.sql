-- CreateTable
CREATE TABLE "ia_configuracao" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "habilitada" BOOLEAN NOT NULL DEFAULT false,
    "limite_por_minuto" INTEGER NOT NULL DEFAULT 10,
    "teto_mensal_usd" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "alterado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "ia_configuracao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ia_caso_uso" (
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "funcionalidade" TEXT NOT NULL,
    "versao_instrucao" INTEGER NOT NULL,
    "guardar_texto" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "modelo" TEXT NOT NULL DEFAULT 'claude-opus-5-5',
    "esforco" TEXT NOT NULL DEFAULT 'medium',
    "max_tokens" INTEGER NOT NULL DEFAULT 4000,
    "teto_mensal_usd" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "ia_caso_uso_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "ia_chamada" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "caso_uso_codigo" TEXT NOT NULL,
    "versao_instrucao" INTEGER NOT NULL,
    "usuario_id" UUID,
    "unidade_id" UUID,
    "modelo" TEXT NOT NULL,
    "modelo_resposta" TEXT,
    "tokens_entrada" INTEGER NOT NULL,
    "tokens_saida" INTEGER NOT NULL,
    "tokens_cache_leitura" INTEGER NOT NULL,
    "tokens_cache_escrita" INTEGER NOT NULL,
    "custo_estimado_usd" DECIMAL(16,8) NOT NULL,
    "latencia_ms" INTEGER NOT NULL,
    "motivo_parada" TEXT,
    "erro" TEXT,
    "hash_entrada" TEXT NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "ia_chamada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ia_chamada_texto" (
    "chamada_id" UUID NOT NULL,
    "entrada" TEXT NOT NULL,
    "saida" TEXT,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "ia_chamada_texto_pkey" PRIMARY KEY ("chamada_id")
);

-- CreateTable
CREATE TABLE "ia_reserva" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "caso_uso_codigo" TEXT NOT NULL,
    "usuario_id" UUID,
    "custo_maximo_usd" DECIMAL(16,8) NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "ia_reserva_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ia_caso_uso_funcionalidade_key" ON "ia_caso_uso"("funcionalidade");

-- CreateIndex
CREATE INDEX "ia_chamada_caso_uso_codigo_criado_em_idx" ON "ia_chamada"("caso_uso_codigo", "criado_em");

-- CreateIndex
CREATE INDEX "ia_chamada_usuario_id_criado_em_idx" ON "ia_chamada"("usuario_id", "criado_em");

-- CreateIndex
CREATE INDEX "ia_chamada_criado_em_idx" ON "ia_chamada"("criado_em");

-- CreateIndex
CREATE INDEX "ia_chamada_texto_criado_em_idx" ON "ia_chamada_texto"("criado_em");

-- CreateIndex
CREATE INDEX "ia_reserva_criado_em_idx" ON "ia_reserva"("criado_em");

-- AddForeignKey
ALTER TABLE "ia_chamada" ADD CONSTRAINT "ia_chamada_caso_uso_codigo_fkey" FOREIGN KEY ("caso_uso_codigo") REFERENCES "ia_caso_uso"("codigo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ia_chamada_texto" ADD CONSTRAINT "ia_chamada_texto_chamada_id_fkey" FOREIGN KEY ("chamada_id") REFERENCES "ia_chamada"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ia_reserva" ADD CONSTRAINT "ia_reserva_caso_uso_codigo_fkey" FOREIGN KEY ("caso_uso_codigo") REFERENCES "ia_caso_uso"("codigo") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Regras que o schema do Prisma não expressa (US-019, spec §4.4).

-- Configuração: uma linha só, criada aqui com a IA desligada (chave geral ia.habilitada).
ALTER TABLE "ia_configuracao" ADD CONSTRAINT "ia_configuracao_unica_check" CHECK ("id" = 1);
ALTER TABLE "ia_configuracao" ADD CONSTRAINT "ia_configuracao_limites_check" CHECK (
  "limite_por_minuto" BETWEEN 1 AND 1000 AND "teto_mensal_usd" >= 0
);
INSERT INTO "ia_configuracao" ("id") VALUES (1);

ALTER TABLE "ia_caso_uso" ADD CONSTRAINT "ia_caso_uso_config_check" CHECK (
  "codigo" ~ '^[a-z]+\.[a-z0-9_]+$'
  AND "versao_instrucao" >= 1
  AND "esforco" IN ('low', 'medium', 'high', 'xhigh', 'max')
  AND "max_tokens" BETWEEN 1 AND 128000
  AND "teto_mensal_usd" >= 0
  AND length("modelo") BETWEEN 1 AND 100
);

ALTER TABLE "ia_chamada" ADD CONSTRAINT "ia_chamada_valores_check" CHECK (
  "tokens_entrada" >= 0 AND "tokens_saida" >= 0 AND "tokens_cache_leitura" >= 0 AND "tokens_cache_escrita" >= 0
  AND "custo_estimado_usd" >= 0 AND "latencia_ms" >= 0
  AND "hash_entrada" ~ '^[0-9a-f]{64}$'
  AND ("erro" IS NULL OR "erro" ~ '^ia\.[a-z_]+$')
);

-- Registro de chamadas somente inserção, como o Histórico: o banco recusa UPDATE, DELETE e TRUNCATE
-- para qualquer papel (trigger) e a aplicação nem tem o privilégio. id e criado_em são do servidor.
CREATE FUNCTION ia_chamada_somente_insercao() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'ia_chamada é somente inserção';
END;
$$;

CREATE TRIGGER ia_chamada_sem_alteracao
  BEFORE UPDATE OR DELETE ON "ia_chamada"
  FOR EACH ROW EXECUTE FUNCTION ia_chamada_somente_insercao();

CREATE TRIGGER ia_chamada_sem_truncate
  BEFORE TRUNCATE ON "ia_chamada"
  FOR EACH STATEMENT EXECUTE FUNCTION ia_chamada_somente_insercao();

-- Privilégios. O app (tela e worker): lê tudo; altera só a configuração (a tela de cadastro); registra
-- chamadas; o texto completo é inserido e apagado (retenção de 90 dias); a reserva, inserida e apagada. Os casos de uso são
-- instalados pelas seeds (migrator). O sgo_sync não toca.
REVOKE ALL ON "ia_configuracao", "ia_caso_uso", "ia_chamada", "ia_chamada_texto", "ia_reserva" FROM sgo_app, sgo_sync;
GRANT SELECT ON "ia_configuracao", "ia_caso_uso", "ia_chamada", "ia_chamada_texto", "ia_reserva" TO sgo_app;
GRANT UPDATE ("habilitada", "limite_por_minuto", "teto_mensal_usd", "alterado_em") ON "ia_configuracao" TO sgo_app;
GRANT UPDATE ("ativo", "modelo", "esforco", "max_tokens", "teto_mensal_usd") ON "ia_caso_uso" TO sgo_app;
GRANT INSERT ("caso_uso_codigo", "versao_instrucao", "usuario_id", "unidade_id", "modelo", "modelo_resposta",
  "tokens_entrada", "tokens_saida", "tokens_cache_leitura", "tokens_cache_escrita", "custo_estimado_usd",
  "latencia_ms", "motivo_parada", "erro", "hash_entrada")
  ON "ia_chamada" TO sgo_app;
GRANT INSERT ("chamada_id", "entrada", "saida"), DELETE ON "ia_chamada_texto" TO sgo_app;
-- Reserva: criada na conferência e apagada no registro (ou na limpeza), sem forjar id nem data.
GRANT INSERT ("caso_uso_codigo", "usuario_id", "custo_maximo_usd"), DELETE ON "ia_reserva" TO sgo_app;
ALTER TABLE "ia_reserva" ADD CONSTRAINT "ia_reserva_custo_check" CHECK ("custo_maximo_usd" >= 0);
