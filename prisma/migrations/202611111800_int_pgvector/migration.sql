-- pgvector para a busca semântica futura (spec §4.4, US-020; GAP-IA-002). A extensão já vem instalada
-- pelo superusuário em todos os bancos (docker/postgres/init/03-privilegios.sql no dev, nos testes e no
-- shadow; deploy/postgres/01-papeis-ambiente.sql em hml e prod): aqui ela é só declarada, e o IF NOT
-- EXISTS não exige superusuário. Nenhuma tabela usa vetor ainda; o provedor de embeddings fica atrás
-- da porta ProvedorEmbeddings (src/shared/ia/embeddings.ts) até haver caso de uso.
CREATE EXTENSION IF NOT EXISTS vector;
