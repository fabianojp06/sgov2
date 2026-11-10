-- US-029 (D-P8-2): a senha temporária da recuperação pela tela de login convive com a senha vigente
-- até ser usada (RN0517: o pedido nunca invalida a senha atual). Uso único: o primeiro login com ela,
-- a troca, a redefinição pelo Administrador, a inativação e o bloqueio a apagam.
-- AlterTable
ALTER TABLE "usuario" ADD COLUMN "recuperacao_hash" TEXT,
ADD COLUMN "recuperacao_expira_em" TIMESTAMPTZ(6);

ALTER TABLE "usuario" ADD CONSTRAINT "usuario_recuperacao_check" CHECK (("recuperacao_hash" IS NULL) = ("recuperacao_expira_em" IS NULL));

-- Privilégios (padrão de 202610260300_adm_acesso): a aplicação grava e apaga a temporária.
GRANT UPDATE ("recuperacao_hash", "recuperacao_expira_em") ON "usuario" TO sgo_app;
