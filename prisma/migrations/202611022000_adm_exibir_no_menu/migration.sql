-- C6 (R24 do P4): funcionalidade com permissão, mas fora do menu e da busca.
-- Só a seed (migrator) grava; o sgo_app continua só com UPDATE (ativo) nesta tabela.
ALTER TABLE "funcionalidade" ADD COLUMN "exibir_no_menu" BOOLEAN NOT NULL DEFAULT true;
