-- Cargo do cadastro de C&S na posição de pessoal (US-056; plano do P15, Task 1, D-P15-1). SQL à mão,
-- conferido pelos testes de integração (que aplicam as migrations num banco descartável).
-- 1) cargo_id: o cargo escolhido na tela. Sem FK de propósito (§12.7, item 1): a tabela cargo é da
--    frente B; a relação entre frentes é por id. Nulo = cargo em texto livre (C34), importação ou
--    posição antiga. Nenhum CHECK novo: a posição IMPORTACAO ligada a cargo pela tela continua
--    IMPORTACAO (D-P12-7). O texto "cargo" continua obrigatório (com cargo, o nome do cadastro).
ALTER TABLE "orc_posicao" ADD COLUMN "cargo_id" UUID;

-- 2) Soma ao GRANT por coluna da 202611101800_orc_posicao_tela: a alteração pela tela grava o cargo;
--    origem, importação e exercício continuam sem UPDATE.
GRANT UPDATE ("cargo_id") ON "orc_posicao" TO sgo_app;
