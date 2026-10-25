-- CreateEnum
CREATE TYPE "TipoOperacao" AS ENUM ('INSERCAO', 'ALTERACAO', 'EXCLUSAO', 'CONSULTA', 'IMPRESSAO', 'EXPORTACAO', 'LOGIN', 'LOGOFF', 'SISTEMA');

-- CreateEnum
CREATE TYPE "OrigemOperacao" AS ENUM ('USUARIO', 'SISTEMA', 'SUGESTAO_IA');

-- CreateTable
CREATE TABLE "historico_operacao" (
    "id" BIGSERIAL NOT NULL,
    "ocorrido_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "unidade_id" UUID,
    "usuario_id" UUID,
    "usuario_rotulo" TEXT NOT NULL,
    "sessao_uid" TEXT,
    "ip" INET,
    "funcionalidade" TEXT NOT NULL,
    "tipo_operacao" "TipoOperacao" NOT NULL,
    "registro_id" TEXT,
    "descricao" TEXT NOT NULL,
    "antes" JSONB,
    "depois" JSONB,
    "delta" JSONB,
    "origem" "OrigemOperacao" NOT NULL DEFAULT 'USUARIO',

    CONSTRAINT "historico_operacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "historico_operacao_funcionalidade_ocorrido_em_idx" ON "historico_operacao"("funcionalidade", "ocorrido_em");

-- CreateIndex
CREATE INDEX "historico_operacao_usuario_id_ocorrido_em_idx" ON "historico_operacao"("usuario_id", "ocorrido_em");

-- Histórico de Operações somente inserção (US-006): o banco recusa UPDATE, DELETE e TRUNCATE
-- para qualquer papel (trigger) e a aplicação nem tem o privilégio (REVOKE).
CREATE FUNCTION historico_somente_insercao() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'historico_operacao é somente inserção';
END;
$$;

CREATE TRIGGER historico_operacao_sem_alteracao
  BEFORE UPDATE OR DELETE ON "historico_operacao"
  FOR EACH ROW EXECUTE FUNCTION historico_somente_insercao();

CREATE TRIGGER historico_operacao_sem_truncate
  BEFORE TRUNCATE ON "historico_operacao"
  FOR EACH STATEMENT EXECUTE FUNCTION historico_somente_insercao();

REVOKE UPDATE, DELETE, TRUNCATE ON "historico_operacao" FROM sgo_app, sgo_sync;

-- id e ocorrido_em são sempre do servidor (TIMESTAMPTZ do servidor, spec §5): a aplicação
-- só insere as demais colunas. Um id forjado à frente da sequência travaria toda auditoria.
REVOKE INSERT ON "historico_operacao" FROM sgo_app, sgo_sync;
GRANT INSERT ("unidade_id", "usuario_id", "usuario_rotulo", "sessao_uid", "ip", "funcionalidade",
  "tipo_operacao", "registro_id", "descricao", "antes", "depois", "delta", "origem")
  ON "historico_operacao" TO sgo_app, sgo_sync;
