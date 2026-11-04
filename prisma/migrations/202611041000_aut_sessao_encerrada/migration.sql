-- US-028 (RN0519, EP084 UC01.02 A2.2): a sessão apagada por um login em outra estação deixa uma marca
-- pelo hash do token, para a estação anterior ver o aviso na próxima interação. A marca vale até o
-- prazo da sessão encerrada e sai no vencimento ou no próximo login do usuário.
-- CreateTable
CREATE TABLE "aut_sessao_encerrada" (
    "token_hash" TEXT NOT NULL,
    "usuario_id" UUID NOT NULL,
    "motivo" TEXT NOT NULL,
    "encerrada_em" TIMESTAMPTZ(6) NOT NULL,
    "expira_em" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "aut_sessao_encerrada_pkey" PRIMARY KEY ("token_hash"),
    CONSTRAINT "aut_sessao_encerrada_motivo_check" CHECK ("motivo" IN ('NOVO_ACESSO'))
);

-- CreateIndex
CREATE INDEX "aut_sessao_encerrada_usuario_id_idx" ON "aut_sessao_encerrada"("usuario_id");

-- CreateIndex
CREATE INDEX "aut_sessao_encerrada_expira_em_idx" ON "aut_sessao_encerrada"("expira_em");

-- AddForeignKey
ALTER TABLE "aut_sessao_encerrada" ADD CONSTRAINT "aut_sessao_encerrada_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Privilégios (spec §11.5): o sincronismo não toca na marca; a aplicação cria, lê e apaga, nunca altera.
REVOKE ALL ON "aut_sessao_encerrada" FROM sgo_sync;
REVOKE UPDATE ON "aut_sessao_encerrada" FROM sgo_app;
