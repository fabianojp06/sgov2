-- Pacotes base zero pela tela (US-057; plano do P11, Task 1). SQL à mão, conferido pelos testes de
-- integração (que aplicam as migrations num banco descartável).
-- 1) Origem 'TELA': pacote lançado pelo Gestor de Diretoria ou pela GFIN; uma reimportação do CC
--    não o substitui. Pacote da tela nunca aponta para importação.
-- 2) Coluna versao: concorrência otimista na alteração e na exclusão (US-011). Começa em 0, como no orc_exercicio e no orc_receita.
ALTER TABLE "orc_pacote" ADD COLUMN "versao" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "orc_pacote"
  DROP CONSTRAINT "orc_pacote_origem_check",
  ADD CONSTRAINT "orc_pacote_origem_check" CHECK ("origem" IN ('IMPORTACAO', 'COPIA', 'TELA')),
  ADD CONSTRAINT "orc_pacote_tela_check" CHECK ("origem" <> 'TELA' OR "importacao_id" IS NULL),
  ADD CONSTRAINT "orc_pacote_versao_check" CHECK ("versao" >= 0);

-- 3) Defesa em profundidade da ORIGEM BLINDADA (D-P11-5): a aplicação só atualiza os dados do
--    pacote e a versão (alterarPacote); origem, importação e exercício nunca mudam por UPDATE.
REVOKE UPDATE ON "orc_pacote" FROM sgo_app;
GRANT UPDATE ("cc", "conta", "justificativa", "prioridade", "quantidade", "valor_unitario", "corrigir_ipca",
  "distribuicao", "mes_ocorrencia", "versao") ON "orc_pacote" TO sgo_app;
