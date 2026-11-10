-- US-040 (UC02.24): a consulta do Histórico filtra por período e por tipo, com paginação no banco.
-- CreateIndex
CREATE INDEX "historico_operacao_ocorrido_em_idx" ON "historico_operacao"("ocorrido_em");

-- CreateIndex
CREATE INDEX "historico_operacao_tipo_operacao_ocorrido_em_idx" ON "historico_operacao"("tipo_operacao", "ocorrido_em");
