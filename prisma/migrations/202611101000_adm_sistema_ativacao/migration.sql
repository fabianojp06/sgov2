-- US-036 e US-033 (EP085 UC02.01, UC02.15, UC02.16; plano do P9, Task 2). Sistema inativo e
-- manutenção são o mesmo indicador (D-P9-1). Desativar pela tela grava o instante em que a
-- desativação vale (agora + espera), o motivo e quem desativou (D-P9-2); a espera entre o aviso e a
-- desconexão é configurável (REQ0089, D-P9-3).
-- AlterTable
ALTER TABLE "configuracao_acesso" ADD COLUMN     "desconexao_espera_min" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "manutencao_a_partir" TIMESTAMPTZ(6),
ADD COLUMN     "manutencao_motivo" TEXT,
ADD COLUMN     "manutencao_por" UUID;

-- AddForeignKey
ALTER TABLE "configuracao_acesso" ADD CONSTRAINT "configuracao_acesso_manutencao_por_fkey" FOREIGN KEY ("manutencao_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Regras que o schema do Prisma não expressa. Espera de 0 a 60 minutos [PROVISÓRIO]; o zero existe
-- para o E2E. Com o indicador desligado, não sobra instante, motivo nem autor de uma desativação.
ALTER TABLE "configuracao_acesso" ADD CONSTRAINT "configuracao_acesso_espera_check" CHECK ("desconexao_espera_min" BETWEEN 0 AND 60);
ALTER TABLE "configuracao_acesso" ADD CONSTRAINT "configuracao_acesso_manutencao_check"
  CHECK ("manutencao" OR ("manutencao_a_partir" IS NULL AND "manutencao_motivo" IS NULL AND "manutencao_por" IS NULL));

-- A desconexão pela desativação do sistema (UC02.15) deixa a marca SISTEMA_INATIVO na sessão
-- apagada: a estação vê "Sistema está em manutenção" na próxima interação.
ALTER TABLE "aut_sessao_encerrada" DROP CONSTRAINT "aut_sessao_encerrada_motivo_check";
ALTER TABLE "aut_sessao_encerrada" ADD CONSTRAINT "aut_sessao_encerrada_motivo_check" CHECK ("motivo" IN ('NOVO_ACESSO', 'SISTEMA_INATIVO'));
