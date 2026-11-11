-- AlterTable
ALTER TABLE "ia_configuracao" ADD COLUMN     "versao" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ia_caso_uso" ADD COLUMN     "versao" INTEGER NOT NULL DEFAULT 1;


-- Versão para a concorrência otimista da tela de cadastro da IA (US-019 parte 2).
ALTER TABLE "ia_configuracao" ADD CONSTRAINT "ia_configuracao_versao_check" CHECK ("versao" >= 1);
ALTER TABLE "ia_caso_uso" ADD CONSTRAINT "ia_caso_uso_versao_check" CHECK ("versao" >= 1);
GRANT UPDATE ("versao") ON "ia_configuracao", "ia_caso_uso" TO sgo_app;
