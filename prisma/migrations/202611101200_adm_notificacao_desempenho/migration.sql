-- US-041 (EP085 UC02.20, grupo "Desempenho"; plano do P10, D-P10-8): quem recebe a notificação de
-- desempenho de cada conta sintética, com o limite em % do orçado e a frequência em dias. A conta é
-- guardada pela classificação do C1, sem FK para a tabela do cad (mesmo padrão do orc); nulo é a
-- opção "Todas" (RN0051). Soft delete como nas alçadas: excluir inativa a linha. Um destinatário só
-- uma vez por conta entre as ativas (A3): NULLS NOT DISTINCT (PG 15+) conta o "Todas" como valor.
-- "Todas" e uma conta específica para o mesmo usuário podem coexistir (o envio deduplica por usuário).
-- O envio (US-085) lerá as ativas e gravará o ultimo_envio_em; os privilégios dele vêm com ele.
-- CreateTable
CREATE TABLE "adm_notificacao_desempenho" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conta_classificacao" TEXT,
    "limite_percentual" DECIMAL(5,2) NOT NULL,
    "frequencia_dias" INTEGER NOT NULL,
    "usuario_id" UUID NOT NULL,
    "ultimo_envio_em" TIMESTAMPTZ(6),
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "inativada_em" TIMESTAMPTZ(6),
    "criada_em" TIMESTAMPTZ(6) NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "adm_notificacao_desempenho_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "adm_notificacao_desempenho_conta_check" CHECK ("conta_classificacao" IS NULL OR "conta_classificacao" ~ '^[0-9]+(\.[0-9]+)*$'),
    CONSTRAINT "adm_notificacao_desempenho_limite_check" CHECK ("limite_percentual" > 0 AND "limite_percentual" <= 999.99),
    CONSTRAINT "adm_notificacao_desempenho_frequencia_check" CHECK ("frequencia_dias" BETWEEN 1 AND 365),
    CONSTRAINT "adm_notificacao_desempenho_inativacao_check" CHECK ("ativa" = ("inativada_em" IS NULL))
);

-- CreateIndex
CREATE UNIQUE INDEX "adm_notificacao_desempenho_conta_usuario_ativa_key" ON "adm_notificacao_desempenho"("conta_classificacao", "usuario_id") NULLS NOT DISTINCT WHERE "ativa";

-- CreateIndex
CREATE INDEX "adm_notificacao_desempenho_usuario_id_idx" ON "adm_notificacao_desempenho"("usuario_id");

-- AddForeignKey
ALTER TABLE "adm_notificacao_desempenho" ADD CONSTRAINT "adm_notificacao_desempenho_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Privilégios (spec §11.5): soft delete, sem DELETE; a aplicação só altera a inativação e a versão
-- (o ultimo_envio_em fica sem UPDATE até o envio existir).
REVOKE ALL ON "adm_notificacao_desempenho" FROM sgo_sync;
REVOKE UPDATE, DELETE, TRUNCATE ON "adm_notificacao_desempenho" FROM sgo_app;
GRANT UPDATE ("ativa", "inativada_em", "versao") ON "adm_notificacao_desempenho" TO sgo_app;
