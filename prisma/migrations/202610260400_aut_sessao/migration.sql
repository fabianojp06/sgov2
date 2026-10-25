-- CreateTable
CREATE TABLE "sessao_usuario" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "sessao_uid" TEXT NOT NULL,
    "ip" INET,
    "criada_em" TIMESTAMPTZ(6) NOT NULL,
    "ultimo_acesso_em" TIMESTAMPTZ(6) NOT NULL,
    "expira_em" TIMESTAMPTZ(6) NOT NULL,
    "acesso_versao" INTEGER NOT NULL,
    "troca_senha_pendente" BOOLEAN NOT NULL,

    CONSTRAINT "sessao_usuario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sessao_usuario_token_hash_key" ON "sessao_usuario"("token_hash");

-- CreateIndex
CREATE INDEX "sessao_usuario_usuario_id_idx" ON "sessao_usuario"("usuario_id");

-- AddForeignKey
ALTER TABLE "sessao_usuario" ADD CONSTRAINT "sessao_usuario_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Privilégios (spec §11.5): o sincronismo do ERP não toca em sessão.
REVOKE ALL ON "sessao_usuario" FROM sgo_sync;
