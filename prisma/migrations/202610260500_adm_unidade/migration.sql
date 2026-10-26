-- CreateTable
CREATE TABLE "usuario_unidade" (
    "usuario_id" UUID NOT NULL,
    "unidade_id" UUID NOT NULL,

    CONSTRAINT "usuario_unidade_pkey" PRIMARY KEY ("usuario_id","unidade_id")
);

-- CreateTable
CREATE TABLE "unidade" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "unidade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unidade_codigo_key" ON "unidade"("codigo");

-- AddForeignKey
ALTER TABLE "usuario_unidade" ADD CONSTRAINT "usuario_unidade_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_unidade" ADD CONSTRAINT "usuario_unidade_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Privilégios (spec §11.5): o sincronismo do ERP não toca em unidades de acesso; a aplicação não
-- apaga unidade (inativação por status); o código da unidade não muda.
REVOKE ALL ON "unidade", "usuario_unidade" FROM sgo_sync;
REVOKE DELETE ON "unidade" FROM sgo_app;
REVOKE UPDATE ON "unidade" FROM sgo_app;
GRANT UPDATE ("nome", "ativo") ON "unidade" TO sgo_app;
