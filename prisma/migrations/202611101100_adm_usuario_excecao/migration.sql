-- US-039 (EP085 UC02.12 A2, UC02.13 A4–A6, REQ0080, REQ0081; plano do P10, D-P10-1 a D-P10-3): exceção
-- de permissão por usuário. A exceção retira de um usuário uma funcionalidade que vem de um perfil
-- associado a ele; é por perfil: outro perfil do usuário que dê a mesma funcionalidade sem exceção a
-- mantém. Retirar o perfil apaga as exceções dele (ON DELETE CASCADE): associá-lo de novo começa sem
-- exceção.
-- CreateTable
CREATE TABLE "adm_usuario_excecao" (
    "usuario_id" UUID NOT NULL,
    "perfil_id" UUID NOT NULL,
    "funcionalidade_codigo" TEXT NOT NULL,

    CONSTRAINT "adm_usuario_excecao_pkey" PRIMARY KEY ("usuario_id","perfil_id","funcionalidade_codigo")
);

-- CreateIndex
CREATE INDEX "adm_usuario_excecao_funcionalidade_codigo_idx" ON "adm_usuario_excecao"("funcionalidade_codigo");

-- AddForeignKey
ALTER TABLE "adm_usuario_excecao" ADD CONSTRAINT "adm_usuario_excecao_usuario_id_perfil_id_fkey" FOREIGN KEY ("usuario_id", "perfil_id") REFERENCES "usuario_perfil"("usuario_id", "perfil_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adm_usuario_excecao" ADD CONSTRAINT "adm_usuario_excecao_funcionalidade_codigo_fkey" FOREIGN KEY ("funcionalidade_codigo") REFERENCES "funcionalidade"("codigo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Privilégios (spec §11.5): o sincronismo do ERP não toca em identidade; a aplicação só inclui e
-- apaga exceções (desfazer a retirada apaga a linha, A5), nunca as altera.
REVOKE ALL ON "adm_usuario_excecao" FROM sgo_sync;
REVOKE ALL ON "adm_usuario_excecao" FROM sgo_app;
GRANT SELECT, INSERT, DELETE ON "adm_usuario_excecao" TO sgo_app;
