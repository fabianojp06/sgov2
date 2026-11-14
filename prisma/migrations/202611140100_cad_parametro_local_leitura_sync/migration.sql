-- C1 com a natureza OPEX/CAPEX (pedido da frente A para a US-072, #138): o listarArvoreContas e o
-- carregarIndiceEstrutura leem conta_parametro_local, e o worker (sgo_sync) também usa o C1. Só leitura:
-- quem grava o parâmetro continua sendo só o app (US-045). A natureza e as faixas não são dado sensível.
GRANT SELECT ON "conta_parametro_local" TO sgo_sync;
