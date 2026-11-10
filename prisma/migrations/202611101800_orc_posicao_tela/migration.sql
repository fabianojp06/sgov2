-- Posições de pessoal pela tela (US-056; plano do P12, Task 1). SQL à mão, conferido pelos testes de
-- integração (que aplicam as migrations num banco descartável). Mesmo desenho da 202611101500_orc_pacote_tela.
-- 1) Origem 'TELA': posição lançada pelo Gestor de Diretoria ou pela GFIN; uma reimportação do CC
--    não a substitui. Posição da tela nunca aponta para importação.
-- 2) Coluna versao: concorrência otimista na alteração e na exclusão (US-011). Começa em 0.
ALTER TABLE "orc_posicao" ADD COLUMN "versao" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "orc_posicao"
  DROP CONSTRAINT "orc_posicao_origem_check",
  ADD CONSTRAINT "orc_posicao_origem_check" CHECK ("origem" IN ('IMPORTACAO', 'COPIA', 'TELA')),
  ADD CONSTRAINT "orc_posicao_tela_check" CHECK ("origem" <> 'TELA' OR "importacao_id" IS NULL),
  ADD CONSTRAINT "orc_posicao_versao_check" CHECK ("versao" >= 0);

-- 3) Defesa em profundidade da ORIGEM BLINDADA (D-P12-7): a aplicação só atualiza os dados da
--    posição e a versão (alterarPosicao); origem, importação e exercício nunca mudam por UPDATE.
REVOKE UPDATE ON "orc_posicao" FROM sgo_app;
GRANT UPDATE ("cc", "cargo", "quantidade", "salario_mensal", "mes_inicio", "mes_saida", "observacao", "versao") ON "orc_posicao" TO sgo_app;
